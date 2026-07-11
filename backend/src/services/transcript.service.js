import { YoutubeTranscript } from 'youtube-transcript';
import { processTranscriptChunk } from './triage.service.js';

// Cache transcripts in memory: videoId -> Array of { text, offset, duration }
const transcriptCache = new Map();

// Map: socketId -> { videoId, lastProcessedTime }
const clientState = new Map();

/**
 * Ensures the transcript is downloaded and cached
 */
export const ensureTranscript = async (videoId) => {
  if (transcriptCache.has(videoId)) {
    return transcriptCache.get(videoId);
  }
  
  try {
    console.log(`[TranscriptService] Fetching full transcript for ${videoId}...`);
    // Try Thai first
    let transcript = null;
    try {
      transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'th' });
    } catch (e) {
      // Fallback to English
      transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    }
    
    transcriptCache.set(videoId, transcript);
    console.log(`[TranscriptService] Cached ${transcript.length} segments for ${videoId}`);
    return transcript;
  } catch (error) {
    console.error(`[TranscriptService] Failed to fetch transcript for ${videoId}:`, error.message);
    transcriptCache.set(videoId, null); // Cache the failure so we don't spam requests
    return null;
  }
};

/**
 * Handle time update from client
 */
export const handleTimeUpdate = async (socketId, videoId, currentTime) => {
  // 1. Ensure transcript is loaded
  const transcript = await ensureTranscript(videoId);
  if (!transcript) return;
  
  // 2. Initialize or get client state
  let state = clientState.get(socketId);
  if (!state || state.videoId !== videoId) {
    // New video or new client
    state = { videoId, lastProcessedTime: currentTime };
    clientState.set(socketId, state);
    return; // Wait for next tick to have a range
  }
  
  // Handle rewinding
  if (currentTime < state.lastProcessedTime) {
    state.lastProcessedTime = currentTime;
    clientState.set(socketId, state);
    return;
  }
  
  // 3. Check if 15 seconds have elapsed
  const timeElapsed = currentTime - state.lastProcessedTime;
  if (timeElapsed >= 15) {
    // Extract text for this time window
    const chunkText = extractTextRange(transcript, state.lastProcessedTime, currentTime);
    
    // Decode HTML entities that youtube-transcript might return
    const cleanText = chunkText.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    
    if (cleanText.trim().split(/\s+/).length >= 5) { // At least 5 words to bother fact-checking
      console.log(`[TranscriptService] Extracted chunk (${timeElapsed.toFixed(1)}s elapsed) for ${videoId}: "${cleanText.substring(0, 30)}..."`);
      
      // Fire and forget fact check
      processTranscriptChunk(videoId, cleanText, currentTime).catch(err => {
        console.error('[TranscriptService] Error processing chunk:', err);
      });
    }
    
    // Update last processed time
    state.lastProcessedTime = currentTime;
    clientState.set(socketId, state);
  }
};

/**
 * Cleanup client state on disconnect
 */
export const removeClient = (socketId) => {
  clientState.delete(socketId);
};

/**
 * Helper to extract text from transcript between two timestamps
 */
function extractTextRange(transcript, startTime, endTime) {
  let text = '';
  for (const seg of transcript) {
    // youtube-transcript returns offset in milliseconds usually, but it depends on the video.
    // Generally it's milliseconds (e.g. 15000 for 15s).
    // Let's normalize to seconds.
    const segStartTime = seg.offset > 100000 || seg.offset > 5000 ? seg.offset / 1000 : seg.offset; 
    
    // We want segments that overlap with our window
    if (segStartTime >= startTime && segStartTime <= endTime) {
      text += ' ' + seg.text;
    }
    if (segStartTime > endTime) break; // Optimization, assume sorted
  }
  return text.trim();
}
