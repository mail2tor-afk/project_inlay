import { YoutubeTranscript } from 'youtube-transcript';
import { processTranscriptChunk } from './triage.service.js';

// Chunking configuration
const CHUNK_WINDOW_SECONDS = 40;    // ขนาดหน้าต่างเวลาต่อ 1 chunk ที่ส่งไป fact-check
const CONTEXT_BEFORE_SECONDS = 60;  // ดึงบทสนทนาก่อนหน้าเพิ่มเป็นบริบท (ไม่ตรวจซ้ำ)
const MIN_WORDS = 12;               // จำนวนคำขั้นต่ำก่อนคุ้มที่จะ fact-check

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
 * Expose clean cached transcript for active video tracking
 */
export const getCachedTranscript = (videoId) => {
  if (transcriptCache.has(videoId)) {
    const list = transcriptCache.get(videoId);
    if (list) {
      return list.map(item => item.text).join(' ');
    }
  }
  return 'ไม่มีประวัติทรานสคริปต์ในระบบ';
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
  
  // 3. Check if the chunk window has elapsed
  const timeElapsed = currentTime - state.lastProcessedTime;
  if (timeElapsed >= CHUNK_WINDOW_SECONDS) {
    // Extract text for this time window
    const chunkText = extractTextRange(transcript, state.lastProcessedTime, currentTime);

    // Decode HTML entities that youtube-transcript might return
    const cleanText = chunkText.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

    // Extract prior conversation as context (for understanding only, not re-checked)
    const rawContextBefore = extractTextRange(
      transcript,
      Math.max(0, state.lastProcessedTime - CONTEXT_BEFORE_SECONDS),
      state.lastProcessedTime
    );
    const contextBefore = rawContextBefore.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

    if (cleanText.trim().split(/\s+/).length >= MIN_WORDS) { // At least MIN_WORDS words to bother fact-checking
      console.log(`[TranscriptService] Extracted chunk (${timeElapsed.toFixed(1)}s elapsed) for ${videoId}: "${cleanText.substring(0, 30)}..."`);

      // Fire and forget fact check
      processTranscriptChunk(videoId, cleanText, currentTime, contextBefore, state.lastProcessedTime).catch(err => {
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
    // youtube-transcript always returns offset in milliseconds.
    const segStartTime = seg.offset / 1000; 
    
    // We want segments that overlap with our window
    if (segStartTime >= startTime && segStartTime <= endTime) {
      text += ' ' + seg.text;
    }
    if (segStartTime > endTime) break; // Optimization, assume sorted
  }
  return text.trim();
}
