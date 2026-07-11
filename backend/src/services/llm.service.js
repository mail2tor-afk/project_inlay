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
You are an expert real-time fact-checker and context provider for video content. Analyze the following transcript chunk.

Your job:
1. If any claim is FALSE or MISLEADING, start your response with "❌ FALSE:" or "⚠️ MISLEADING:" and explain why.
2. If the claims are ACCURATE but noteworthy, start with "✅ VERIFIED:" and provide brief supporting context or interesting related facts.
3. If the content is just filler/transition (greetings, "let's move on", etc.), respond with exactly "SKIP".

Keep your response concise (2-3 sentences max). Respond in the same language as the transcript.

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
    
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullText += chunkText;
      
      // Broadcast the accumulated text to all connected users
      await publish(channelName, { 
        type: 'chunk', 
        text: fullText 
      });
    }
    
    console.log(`[LLM] Completed fact-check: "${fullText.substring(0, 50)}..."`);
    
    // Check if AI said to skip (filler content)
    if (fullText.trim() === "SKIP" || fullText.trim().includes("NO_FACT_CHECK_NEEDED")) {
      await publish(channelName, { type: 'cancel' });
      return null;
    }
    
    // Broadcast completion
    await publish(channelName, { type: 'done', text: fullText.trim() });
    return fullText.trim();

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
