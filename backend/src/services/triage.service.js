import { similaritySearch } from './rag.service.js';
import { streamFactCheck } from './llm.service.js';
import { saveState } from './redis.service.js';

// Cache to prevent duplicate processing of the same chunk
const processedChunks = new Set();

/**
 * Triage function that decides how to handle a transcript chunk
 * @param {string} videoId 
 * @param {string} chunkText 
 * @param {number} timestamp 
 */
export const processTranscriptChunk = async (videoId, chunkText, timestamp) => {
  // 1. Basic deduplication
  const chunkHash = `${videoId}:${chunkText.substring(0, 20)}`;
  if (processedChunks.has(chunkHash)) return;
  processedChunks.add(chunkHash);
  
  // Cleanup cache if it grows too large (just for simple memory management)
  if (processedChunks.size > 1000) processedChunks.clear();

  try {
    console.log(`[Triage] Processing chunk for ${videoId} at ${timestamp}s`);
    
    // 2. Fast Path: Similarity Search (Zero-Latency Fallback)
    const similarDocs = await similaritySearch(chunkText, 0.9, 1);
    
    let ragContext = "";
    
    if (similarDocs.length > 0 && similarDocs[0].similarity > 0.9) {
      console.log(`[Triage] Found exact match in DB. Emitting immediately!`);
      // It's a high confidence match, we can just use the DB result!
      // In a real implementation, you might just broadcast similarDocs[0].content immediately
      ragContext = similarDocs[0].content;
    } else if (similarDocs.length > 0) {
      // Moderate confidence, use as context for LLM
      ragContext = similarDocs.map(d => d.content).join("\n");
    }

    // 3. Deep Fact Check (LLM)
    // Send to LLM to stream the response
    const finalResult = await streamFactCheck(videoId, chunkText, ragContext);
    
    // 4. Save to Redis State for Latecomers (if a fact-check was actually generated)
    if (finalResult) {
      const stateKey = `state:${videoId}`;
      const stateData = {
        lastFactCheck: finalResult,
        timestamp: Date.now(),
        videoTime: timestamp
      };
      await saveState(stateKey, stateData, 3600); // 1 hour TTL
    }

  } catch (error) {
    console.error('[Triage] Error processing chunk:', error);
  }
};
