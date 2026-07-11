import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';
import { publish } from './redis.service.js';

let genAI = null;

export const initLLM = () => {
  if (config.gemini.apiKey) {
    genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    console.log('[LLM] Gemini API initialized');
  } else {
    console.warn('[LLM] Gemini API Key missing. Operating in mock mode.');
  }
};

const FACT_CHECK_PROMPT = `
You are an expert fact-checker. Please analyze the following transcript chunk and any provided context from our database.
Provide a concise fact-check or context addition if necessary. If everything seems factual and doesn't need context, just output "NO_FACT_CHECK_NEEDED".

Context from reliable database:
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

  const MAX_RETRIES = 3;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
      
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
      
      // Check if AI said no fact check is needed
      if (fullText.trim().includes("NO_FACT_CHECK_NEEDED")) {
        await publish(channelName, { type: 'cancel' });
        return null;
      }
      
      // Broadcast completion
      await publish(channelName, { type: 'done', text: fullText.trim() });
      return fullText.trim();

    } catch (error) {
      const isRateLimit = error.status === 429;
      
      if (isRateLimit && attempt < MAX_RETRIES) {
        // Extract retry delay from error if available, default to exponential backoff
        const retryDelay = error.errorDetails?.find(d => d.retryDelay)?.retryDelay;
        const waitMs = retryDelay ? parseInt(retryDelay) * 1000 : (attempt * 15000);
        console.log(`[LLM] Rate limited (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${waitMs/1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      
      console.error(`[LLM] Error in streamFactCheck (attempt ${attempt}):`, error.message || error);
      
      const errorMsg = isRateLimit 
        ? 'API quota exceeded. Please check your Gemini API key and billing.'
        : 'Fact check failed: ' + (error.message || 'Unknown error');
      
      await publish(channelName, { type: 'error', message: errorMsg });
      return null;
    }
  }
};
