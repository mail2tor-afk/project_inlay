// YouTube Transcript Extractor
// Injected into YouTube pages to extract closed captions/transcripts

class TranscriptExtractor {
  constructor() {
    this.currentVideoId = null;
    this.transcriptData = null;
    this.isExtracting = false;
  }

  // Extract video ID from URL
  getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
  }

  // Get caption track URL from YouTube's internal data
  async getTranscriptUrl(videoId) {
    try {
      // 1. Try to get it from the ytInitialPlayerResponse variable (if available)
      if (window.ytInitialPlayerResponse && 
          window.ytInitialPlayerResponse.captions && 
          window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer &&
          window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks) {
        
        const tracks = window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
        // Find English or fallback to first available
        const track = tracks.find(t => t.languageCode === 'en' || t.languageCode === 'th') || tracks[0];
        if (track) return track.baseUrl;
      }

      // 2. Fallback: Fetch the video page and parse the ytInitialPlayerResponse from HTML
      const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
      const html = await response.text();
      
      const regex = /"captions":({.*?})/;
      const match = html.match(regex);
      
      if (match && match[1]) {
        // The regex might capture more than we want, let's try to extract just the valid JSON part
        // A simple workaround for this specific YouTube structure
        let captionsJson = match[1];
        try {
           // Try to parse the first match
           const parsed = JSON.parse(captionsJson);
           if (parsed.playerCaptionsTracklistRenderer && parsed.playerCaptionsTracklistRenderer.captionTracks) {
             const tracks = parsed.playerCaptionsTracklistRenderer.captionTracks;
             const track = tracks.find(t => t.languageCode === 'en' || t.languageCode === 'th') || tracks[0];
             if (track) return track.baseUrl;
           }
        } catch (e) {
           // JSON parse might fail if regex matches too much, this is a basic extraction approach
           console.log('[Transcript] Could not parse captions from HTML block');
        }
      }
      
      return null;
    } catch (error) {
      console.error('[Transcript] Error finding transcript URL:', error);
      return null;
    }
  }

  // Fetch and parse the actual XML transcript
  async fetchTranscript(url) {
    try {
      const response = await fetch(url);
      const xmlString = await response.text();
      
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, "text/xml");
      const textNodes = xmlDoc.getElementsByTagName("text");
      
      const transcript = [];
      for (let i = 0; i < textNodes.length; i++) {
        const node = textNodes[i];
        transcript.push({
          start: parseFloat(node.getAttribute("start")),
          duration: parseFloat(node.getAttribute("dur") || 0),
          text: node.textContent.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        });
      }
      
      return transcript;
    } catch (error) {
      console.error('[Transcript] Error fetching/parsing transcript:', error);
      return null;
    }
  }

  // Start extraction process
  async extract() {
    const videoId = this.getVideoId();
    
    if (!videoId) {
      return null;
    }
    
    if (this.currentVideoId === videoId && this.transcriptData) {
      return this.transcriptData; // Return cached
    }
    
    this.isExtracting = true;
    console.log(`[Transcript] Extracting for video: ${videoId}`);
    
    const url = await this.getTranscriptUrl(videoId);
    
    if (!url) {
      console.log('[Transcript] No transcript available for this video');
      this.isExtracting = false;
      return null;
    }
    
    const data = await this.fetchTranscript(url);
    
    if (data) {
      this.currentVideoId = videoId;
      this.transcriptData = data;
      console.log(`[Transcript] Extracted ${data.length} segments`);
      
      // Send to background script
      chrome.runtime.sendMessage({
        action: 'transcriptExtracted',
        data: {
          videoId,
          transcript: data
        }
      });
      
      this.isExtracting = false;
      return data;
    }
    
    this.isExtracting = false;
    return null;
  }
}

// Initialize and listen for events
const transcriptExtractor = new TranscriptExtractor();

// YouTube is an SPA, so we need to detect navigation
let lastUrl = location.href; 
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    if (url.includes('/watch')) {
      // Small delay to let page settle
      setTimeout(() => transcriptExtractor.extract(), 2000);
    }
  }
}).observe(document, { subtree: true, childList: true });

// Initial extract if on watch page
if (location.href.includes('/watch')) {
  setTimeout(() => transcriptExtractor.extract(), 2000);
}
