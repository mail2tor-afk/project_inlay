// YouTube Transcript Extractor & Chunker
// Injected into YouTube pages to extract closed captions and send chunks to backend

class TranscriptExtractor {
  constructor() {
    this.currentVideoId = null;
    this.transcriptData = null;
    this.isExtracting = false;
    
    // Chunking state
    this.currentChunk = {
      text: "",
      startTime: 0,
      wordCount: 0
    };
    this.lastSentIndex = -1;
    this.videoElement = null;
    this.timeUpdateListener = null;
  }

  getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
  }

  async getTranscriptUrl(videoId) {
    try {
      const response = await fetch('https://www.youtube.com/watch?v=' + videoId);
      const html = await response.text();
      
      const startStr = '"captions":{';
      const startIndex = html.indexOf(startStr);
      if (startIndex === -1) {
        this.sendLogToBackend('warn', 'No captions block found in HTML');
        return null;
      }
      
      let braceCount = 0;
      let jsonStr = '';
      let started = false;
      
      // Start at the opening brace of {"playerCaptionsTracklistRenderer":...
      for (let i = startIndex + 11; i < html.length; i++) {
        const char = html[i];
        jsonStr += char;
        
        if (char === '{') {
          started = true;
          braceCount++;
        } else if (char === '}') {
          braceCount--;
        }
        
        if (started && braceCount === 0) {
          break; // Found the matching closing brace
        }
      }
      
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.playerCaptionsTracklistRenderer && parsed.playerCaptionsTracklistRenderer.captionTracks) {
          const tracks = parsed.playerCaptionsTracklistRenderer.captionTracks;
          const track = tracks.find(t => t.languageCode === 'en' || t.languageCode === 'th') || tracks[0];
          if (track) return track.baseUrl;
        }
      } catch (e) {
        this.sendLogToBackend('error', 'Failed to parse captions JSON', { error: e.toString() });
      }
      
      return null;
    } catch (error) {
      this.sendLogToBackend('error', 'Failed to fetch YouTube HTML', { error: error.toString() });
      return null;
    }
  }

  async fetchTranscript(url) {
    try {
      // Force JSON3 format to avoid XML parsing issues if YouTube defaults to something else
      const fetchUrl = url + (url.includes('?') ? '&' : '?') + 'fmt=json3';
      this.sendLogToBackend('info', 'Fetching transcript URL', { fetchUrl });
      
      const response = await fetch(fetchUrl);
      const textResponse = await response.text();
      
      this.sendLogToBackend('info', 'Raw response sample', { sample: textResponse.substring(0, 150) });
      
      const parsed = JSON.parse(textResponse);
      if (!parsed.events) {
        this.sendLogToBackend('error', 'No events in JSON3 transcript');
        return [];
      }
      
      const transcript = [];
      for (const event of parsed.events) {
        if (event.segs && event.segs.length > 0) {
          const text = event.segs.map(s => s.utf8).join('').replace(/\n/g, ' ');
          if (text.trim() !== '') {
            transcript.push({
              start: (event.tStartMs / 1000) || 0,
              duration: (event.dDurationMs / 1000) || 0,
              text: text
            });
          }
        }
      }
      return transcript;
    } catch (error) {
      this.sendLogToBackend('error', 'Error fetching/parsing transcript', { error: error.toString() });
      return null;
    }
  }

  async extract() {
    const videoId = this.getVideoId();
    if (!videoId) return null;
    
    if (this.currentVideoId === videoId && this.transcriptData) {
      this.setupVideoListener(); // Ensure listener is attached
      return this.transcriptData;
    }
    
    this.isExtracting = true;
    this.sendLogToBackend('info', `Extracting for video: ${videoId}`);
    console.log(`[Transcript] Extracting for video: ${videoId}`);
    
    const url = await this.getTranscriptUrl(videoId);
    if (!url) {
      this.sendLogToBackend('warn', `No transcript URL found for video: ${videoId}`);
      console.log('[Transcript] No transcript available for this video');
      this.isExtracting = false;
      return null;
    }
    
    this.sendLogToBackend('info', `Found transcript URL`, { url });
    const data = await this.fetchTranscript(url);
    if (data) {
      this.currentVideoId = videoId;
      this.transcriptData = data;
      this.lastSentIndex = -1;
      this.resetChunk();
      this.sendLogToBackend('success', `Extracted ${data.length} segments`);
      console.log(`[Transcript] Extracted ${data.length} segments`);
      
      this.setupVideoListener();
      
      this.isExtracting = false;
      return data;
    }
    
    this.sendLogToBackend('error', `fetchTranscript returned null`);
    this.isExtracting = false;
    return null;
  }

  resetChunk() {
    this.currentChunk = { text: "", startTime: 0, wordCount: 0 };
  }

  sendLogToBackend(level, msg, data = {}) {
    try {
      chrome.runtime.sendMessage({
        action: 'relayFetch',
        url: 'http://localhost:3000/api/debug',
        method: 'POST',
        body: { level, msg, data }
      });
    } catch(e) {}
  }

  sendChunkToBackend(text, timestamp) {
    if (!text.trim()) return;
    
    this.sendLogToBackend('info', 'Sending chunk to backend', { textLength: text.length, timestamp });
    console.log(`[Transcript] Sending chunk to backend:`, text);
    
    chrome.runtime.sendMessage({
      action: 'relayFetch',
      url: 'http://localhost:3000/api/transcript/chunk',
      method: 'POST',
      body: {
        videoId: this.currentVideoId,
        text: text,
        timestamp: timestamp
      }
    });
  }

  setupVideoListener() {
    if (this.timeUpdateListener && this.videoElement) {
      this.videoElement.removeEventListener('timeupdate', this.timeUpdateListener);
    }

    this.videoElement = document.querySelector('video');
    if (!this.videoElement) {
      // Try again later if video not found
      setTimeout(() => this.setupVideoListener(), 1000);
      return;
    }

    this.timeUpdateListener = () => {
      if (!this.transcriptData) return;
      const currentTime = this.videoElement.currentTime;

      // Find the transcript segment for current time
      // To optimize, we start searching from lastSentIndex
      let currentIndex = this.lastSentIndex + 1;
      
      while (currentIndex < this.transcriptData.length) {
        const segment = this.transcriptData[currentIndex];
        
        // If we haven't reached this segment yet, break
        if (segment.start > currentTime) break;
        
        // Accumulate text
        if (this.currentChunk.text === "") {
          this.currentChunk.startTime = segment.start;
        }
        
        this.currentChunk.text += " " + segment.text;
        this.currentChunk.wordCount += segment.text.split(/\s+/).length;
        this.lastSentIndex = currentIndex;
        currentIndex++;
      }

      // Check chunking limits: 15 seconds elapsed OR 50 words
      const timeElapsed = currentTime - this.currentChunk.startTime;
      if (this.currentChunk.text && (timeElapsed >= 15 || this.currentChunk.wordCount >= 50)) {
        this.sendChunkToBackend(this.currentChunk.text.trim(), currentTime);
        this.resetChunk();
      }
    };

    this.videoElement.addEventListener('timeupdate', this.timeUpdateListener);
    console.log('[Transcript] Video listener attached for chunking');
  }
}

const transcriptExtractor = new TranscriptExtractor();

let lastUrl = location.href; 
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    if (url.includes('/watch')) {
      setTimeout(() => transcriptExtractor.extract(), 2000);
    }
  }
}).observe(document, { subtree: true, childList: true });

if (location.href.includes('/watch')) {
  setTimeout(() => transcriptExtractor.extract(), 2000);
}
