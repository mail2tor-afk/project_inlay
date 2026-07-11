import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';
import { publish } from './redis.service.js';

let genAI = null;

// Queue lock: only one LLM call at a time to prevent rate limit avalanche
let isProcessing = false;

export const initLLM = () => {
  if (config.gemini.apiKey) {
    genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    console.log('[LLM] Gemini API initialized');
  } else {
    console.warn('[LLM] Gemini API Key missing. Operating in mock mode.');
  }
};

const FACT_CHECK_PROMPT = `
You are an expert real-time fact-checker for video content. Analyze the following transcript chunk.

Your job:
1. Identify the speaker if there are verbal cues or dialog cues in the transcript. If not possible to determine, use a generic label like "ผู้ดำเนินรายการ" or "ผู้พูด".
2. Determine the core topic being discussed in this chunk (max 5 words).
3. Evaluate the factual accuracy of any statements:
   - If a claim is FALSE or MISLEADING, verdict is "FALSE" or "MISLEADING".
   - If a claim is accurate but there is a CRITICAL piece of missing context required to prevent major misunderstanding, verdict is "CONTEXT_NEEDED".
   - If the statements are accurate, standard opinions, greetings, filler, or do not contain any major factual claims that require correction, you must respond with exactly "SKIP" (no other text).

You must output your response in this EXACT tagged structure (do not include markdown code block formatting, just the raw text):
[TOPIC: <brief topic name>]
[SPEAKER: <speaker name>]
[VERDICT: <FALSE | MISLEADING | CONTEXT_NEEDED>]
[ANALYSIS: <concise 2-3 sentences fact-check or context addition explaining the correction, in the same language as the transcript>]

Context from database:
{CONTEXT}

Transcript to analyze:
{TRANSCRIPT}
`;

/**
 * Fact check using Gemini Stream
 * Streams the response to Redis pub/sub channel for real-time broadcast
 */
export const streamFactCheck = async (videoId, transcriptChunk, ragContext = '') => {
  const channelName = `factcheck:${videoId}`;
  
  // Skip if already processing another chunk (prevent rate limit avalanche)
  if (isProcessing) {
    console.log(`[LLM] Skipping chunk - already processing another request`);
    return null;
  }
  
  if (!genAI) {
    // Mock streaming
    console.log(`[LLM Mock] Fact checking for ${videoId}`);
    const mockText = "This is a mock fact-check result streamed word by word.";
    const words = mockText.split(' ');
    
    let fullText = "";
    for (const word of words) {
      fullText += word + " ";
      await publish(channelName, { type: 'chunk', text: fullText });
      await new Promise(r => setTimeout(r, 100)); // Delay
    }
    await publish(channelName, { type: 'done', text: fullText.trim() });
    return fullText.trim();
  }

  isProcessing = true;
  console.log(`[LLM] Starting fact-check for ${videoId}...`);
  
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    
    const prompt = FACT_CHECK_PROMPT
      .replace('{CONTEXT}', ragContext || 'No context found.')
      .replace('{TRANSCRIPT}', transcriptChunk);

    const result = await model.generateContentStream(prompt);
    
    let fullText = "";
    let shouldStream = null; // null = undecided, true = stream, false = discard/skip
    
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullText += chunkText;
      
      // Determine if we should stream this response to the client
      if (shouldStream === null) {
        // If the model output indicates an early skip
        if (fullText.includes("SKIP") || fullText.toLowerCase().includes("no_fact_check_needed")) {
          shouldStream = false;
          console.log(`[LLM] Skipped early: filler or accurate content`);
        } 
        // Once we hit the VERDICT tag, we can decide based on the value
        else if (fullText.includes("[VERDICT:")) {
          const verdictMatch = fullText.match(/\[VERDICT:\s*([^\]]*?)\]/i);
          if (verdictMatch) {
            const verdict = verdictMatch[1].trim().toUpperCase();
            if (verdict === 'FALSE' || verdict === 'MISLEADING' || verdict === 'CONTEXT_NEEDED') {
              shouldStream = true;
              console.log(`[LLM] Verdict is ${verdict} - starting stream for ${videoId}`);
              // Send the initial buffered text up to this point
              await publish(channelName, { 
                type: 'chunk', 
                text: fullText 
              });
            } else {
              shouldStream = false;
              console.log(`[LLM] Verdict is ${verdict} - skipping stream for ${videoId}`);
            }
          }
        }
      } else if (shouldStream === true) {
        // Broadcast the accumulated text to the client
        await publish(channelName, { 
          type: 'chunk', 
          text: fullText 
        });
      }
    }
    
    console.log(`[LLM] Completed processing for ${videoId}. shouldStream: ${shouldStream}`);
    
    if (shouldStream === true) {
      // Broadcast completion
      await publish(channelName, { type: 'done', text: fullText.trim() });
      return fullText.trim();
    } else {
      await publish(channelName, { type: 'cancel' });
      return null;
    }

  } catch (error) {
    console.error(`[LLM] Error:`, error.message || error);
    
    const errorMsg = error.status === 429
      ? 'API quota exceeded. Please wait or check billing.'
      : 'Fact check failed: ' + (error.message || 'Unknown error');
    
    await publish(channelName, { type: 'error', message: errorMsg });
    return null;
  } finally {
    isProcessing = false;
  }
};
