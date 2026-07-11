import { subscribe, getState } from '../services/redis.service.js';
import { handleTimeUpdate, removeClient } from '../services/transcript.service.js';

const activeSubscriptions = new Set();

// In-memory vote database for factcheck cards
const voteRegistry = {};

// In-memory registry of factchecks created in the current active session
const sessionFactChecks = {};

function parseFactCheckMessage(rawText, factCheckId) {
  const topicMatch = rawText.match(/\[TOPIC:\s*([^\]]*?)\]/i);
  const speakerMatch = rawText.match(/\[SPEAKER:\s*([^\]]*?)\]/i);
  const verdictMatch = rawText.match(/\[VERDICT:\s*([^\]]*?)\]/i);
  const analysisMatch = rawText.match(/\[ANALYSIS:\s*([^\]]*?)\]/i);
  
  return {
    id: factCheckId,
    topic: topicMatch ? topicMatch[1].trim() : 'N/A',
    speaker: speakerMatch ? speakerMatch[1].trim() : 'N/A',
    verdict: verdictMatch ? verdictMatch[1].trim() : 'N/A',
    analysis: analysisMatch ? analysisMatch[1].trim() : 'N/A',
    rawText
  };
}

const handleRoomEmpty = async (io, videoId) => {
  const room = io.sockets.adapter.rooms.get(videoId);
  if (!room || room.size === 0) {
    console.log(`[Socket] Room ${videoId} is empty. Starting post-video audit...`);
    
    // 1. Get full transcript
    const { ensureTranscript } = await import('../services/transcript.service.js');
    const transcriptSegs = await ensureTranscript(videoId);
    if (!transcriptSegs) {
      console.log(`[Audit] No transcript available for video ${videoId}, aborting audit.`);
      return;
    }
    const fullTranscript = transcriptSegs.map(s => s.text).join(' ');
    
    // 2. Get session factchecks
    const factChecks = sessionFactChecks[videoId] || [];
    if (factChecks.length === 0) {
      console.log(`[Audit] No factchecks generated during session for video ${videoId}, skipping audit.`);
      return;
    }
    
    // 3. Trigger audit
    const { runPostVideoAudit } = await import('../services/audit.service.js');
    try {
      await runPostVideoAudit(videoId, fullTranscript, factChecks);
    } catch (err) {
      console.error(`[Audit] Error running audit for ${videoId}:`, err);
    }
    
    // 4. Cleanup session memory
    delete sessionFactChecks[videoId];
  }
};

function shouldSkipVideoBasedOnMetadata(metadata) {
  if (!metadata) return false;
  const title = (metadata.title || '').toLowerCase();
  const channel = (metadata.channel || '').toLowerCase();
  
  // Keywords indicating categories that do not need factual analysis (entertainment, vlogs, gaming, music)
  const skipKeywords = [
    'asmr', 'gameplay', 'lets play', 'gaming', 'minecraft', 'roblox', 'music video', 
    'official audio', 'song', 'karaoke', 'cooking recipe', 'make up', 'vlog', 'daily vlog',
    'mukbang', 'unboxing', 'pubg', 'gta', 'fifa', 'cover song', 'relaxing music'
  ];
  
  return skipKeywords.some(keyword => title.includes(keyword) || channel.includes(keyword));
}

export const setupSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    console.log(`[Socket] User connected: ${socket.id}`);

    // Join a room for a specific video
    socket.on('join_video', async (data) => {
      // Handle either string (old format) or object with metadata (new format)
      const videoId = typeof data === 'string' ? data : data.videoId;
      const metadata = typeof data === 'object' ? data.metadata : null;

      console.log(`[Socket] ${socket.id} joined video: ${videoId}`);
      socket.join(videoId);

      // Check category metadata to see if we should skip fact-checking
      if (shouldSkipVideoBasedOnMetadata(metadata)) {
        socket.skipFactChecking = true;
        console.log(`[Socket] Auto-disabled analysis for ${videoId} (Entertainment/ASMR/Vlog detected)`);
        socket.emit('factcheck_disabled', { 
          reason: 'หมวดหมู่คลิปไม่จำเป็นต้องเปิดระบบ Fact-check (เช่น บันเทิง, เกม, เพลง, ASMR)' 
        });
      } else {
        socket.skipFactChecking = false;
      }

      // Latecomer state retrieval
      const stateKey = `state:${videoId}`;
      const previousState = await getState(stateKey);
      
      if (previousState && !socket.skipFactChecking) {
        console.log(`[Socket] Sending latecomer state to ${socket.id}`);
        
        // Match UUID if present in previous state or extract factCheckId
        const factCheckId = previousState.factCheckId || `fc_${videoId}_late`;
        const votes = voteRegistry[factCheckId] || { likes: 0, dislikes: 0 };
        
        socket.emit('factcheck_update', {
          type: 'done',
          text: previousState.lastFactCheck,
          factCheckId: factCheckId,
          likes: votes.likes,
          dislikes: votes.dislikes,
          isLatecomer: true
        });
      }

      // Ensure we have a Redis subscription for this video
      subscribeToRedisChannel(io, videoId);
    });
    
    // Receive current video time from extension
    socket.on('video_time_update', (data) => {
      // If auto-disabled for this socket/video, skip sending updates to transcript service
      if (socket.skipFactChecking) return;

      if (data && data.videoId && typeof data.currentTime === 'number') {
        handleTimeUpdate(socket.id, data.videoId, data.currentTime).catch(err => {
          console.error('[Socket] Error handling time update:', err);
        });
      }
    });

    // Handle Like/Dislike votes on fact-check cards
    socket.on('vote_factcheck', ({ factCheckId, voteType, videoId }) => {
      if (!voteRegistry[factCheckId]) {
        voteRegistry[factCheckId] = { likes: 0, dislikes: 0 };
      }
      
      if (voteType === 'like') {
        voteRegistry[factCheckId].likes++;
      } else if (voteType === 'dislike') {
        voteRegistry[factCheckId].dislikes++;
      }
      
      console.log(`[Vote] ${factCheckId} updated: likes=${voteRegistry[factCheckId].likes}, dislikes=${voteRegistry[factCheckId].dislikes}`);
      
      // Broadcast updated vote counts to all sockets in the video room
      io.to(videoId).emit('vote_update', {
        factCheckId,
        likes: voteRegistry[factCheckId].likes,
        dislikes: voteRegistry[factCheckId].dislikes
      });
    });

    socket.on('leave_video', (videoId) => {
      console.log(`[Socket] ${socket.id} left video: ${videoId}`);
      socket.leave(videoId);
      
      // Schedule empty-room check after leaving
      setTimeout(() => {
        handleRoomEmpty(io, videoId);
      }, 100);
    });

    // Inspect rooms before client disconnected
    socket.on('disconnecting', () => {
      const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
      for (const roomId of rooms) {
        setTimeout(() => {
          handleRoomEmpty(io, roomId);
        }, 100);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] User disconnected: ${socket.id}`);
      removeClient(socket.id);
    });
  });
};

const subscribeToRedisChannel = (io, videoId) => {
  const channelName = `factcheck:${videoId}`;
  
  // Prevent duplicate subscriptions per Node instance
  if (activeSubscriptions.has(channelName)) return;
  
  activeSubscriptions.add(channelName);
  console.log(`[Redis-Socket] Node instance subscribed to Redis channel: ${channelName}`);
  
  // When a message comes from Redis Pub/Sub, broadcast it to all sockets in the video room
  subscribe(channelName, (message) => {
    // Inject current vote counts if type is done/chunk and factCheckId is present
    if (message.factCheckId) {
      const votes = voteRegistry[message.factCheckId] || { likes: 0, dislikes: 0 };
      message.likes = votes.likes;
      message.dislikes = votes.dislikes;

      // Capture completed factcheck into session data for auditing
      if (message.type === 'done') {
        if (!sessionFactChecks[videoId]) {
          sessionFactChecks[videoId] = [];
        }
        const parsedFc = parseFactCheckMessage(message.text, message.factCheckId);
        // Avoid duplicate saves of the same card in the session array
        if (!sessionFactChecks[videoId].some(fc => fc.id === parsedFc.id)) {
          sessionFactChecks[videoId].push(parsedFc);
          console.log(`[Audit Session] Captured factcheck card for auditing: ${parsedFc.id}`);
        }
      }
    }
    io.to(videoId).emit('factcheck_update', message);
  });
};
