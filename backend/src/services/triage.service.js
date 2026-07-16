import { similaritySearch } from './rag.service.js';
import { streamFactCheck } from './llm.service.js';
import { saveState, publish } from './redis.service.js';
import { getCachedResult } from './cache.service.js';

// Cache to prevent duplicate processing of the same chunk
const processedChunks = new Set();

/**
 * Triage function that decides how to handle a transcript chunk
 * @param {string} videoId
 * @param {string} chunkText
 * @param {number} timestamp
 * @param {string} contextBefore บทสนทนาช่วงก่อนหน้า (ใช้เป็นบริบทเท่านั้น)
 * @param {number} chunkStartTime เวลาเริ่มของ chunk นี้ (ใช้เป็น key สำหรับ persistent cache)
 */
export const processTranscriptChunk = async (videoId, chunkText, timestamp, contextBefore = '', chunkStartTime = timestamp) => {
  // 1. Basic deduplication (กันซ้ำภายใน process/room เดียวกัน ช่วงสั้นๆ)
  const chunkHash = `${videoId}:${chunkText.substring(0, 20)}`;
  if (processedChunks.has(chunkHash)) return;
  processedChunks.add(chunkHash);

  // Cleanup cache if it grows too large (just for simple memory management)
  if (processedChunks.size > 1000) processedChunks.clear();

  try {
    // 1.5 Persistent cache: วิดีโอ/ช่วงเวลานี้เคยเช็คไปแล้วหรือยัง (ข้ามเซสชัน/ข้าม server restart)
    // ถ้าเคย ส่งผลเดิมให้ผู้ชมรอบนี้เลย ไม่ต้องยิง RAG/AI ซ้ำ
    const cachedResult = getCachedResult(videoId, chunkStartTime);
    if (cachedResult !== undefined) {
      console.log(`[Triage] Persistent cache hit for ${videoId} @${chunkStartTime}s - reusing prior result, no AI call`);
      if (cachedResult !== 'SKIP') {
        const channelName = `factcheck:${videoId}`;
        const factCheckId = `fc_${videoId}_${Date.now()}`;
        await publish(channelName, { type: 'chunk', text: cachedResult, factCheckId });
        await publish(channelName, { type: 'done', text: cachedResult, factCheckId });

        await saveState(`state:${videoId}`, {
          lastFactCheck: cachedResult,
          timestamp: Date.now(),
          videoTime: timestamp
        }, 3600);
      }
      return;
    }

    console.log(`[Triage] Processing chunk for ${videoId} at ${timestamp}s`);

    // 2. Fast Path: Similarity Search (Zero-Latency Fallback)
    const similarDocs = await similaritySearch(chunkText, 0.7, 3);
    
    let ragContext = "";
    
    if (similarDocs.length > 0 && similarDocs[0].similarity > 0.9) {
      console.log(`[Triage] Found exact match in DB. Emitting immediately!`);
      ragContext = similarDocs[0].content;
    } else if (similarDocs.length > 0) {
      // Moderate confidence, use as context for LLM
      ragContext = similarDocs.map(d => d.content).join("\n");
    }

    // Conditional grounding: เปิด Google Search grounding เฉพาะเมื่อ RAG อ่อน (คุม cost)
    const needsGrounding = similarDocs.length === 0 || similarDocs[0].similarity < 0.8;

    // 3. Deep Fact Check (LLM)
    // Send to LLM to stream the response
    const finalResult = await streamFactCheck(videoId, chunkText, ragContext, contextBefore, needsGrounding, chunkStartTime);
    
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
