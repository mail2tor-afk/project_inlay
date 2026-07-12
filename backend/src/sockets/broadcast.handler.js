import { subscribe, getState, saveState } from '../services/redis.service.js';
import { handleTimeUpdate, removeClient } from '../services/transcript.service.js';
import { setVideoMetadata } from '../services/video-metadata.service.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const activeSubscriptions = new Set();
const votesDbPath = path.resolve(__dirname, '../../factchecks_votes.json');

// Helper to load persistent votes
const loadVotesRegistry = () => {
  try {
    if (fs.existsSync(votesDbPath)) {
      const fileData = fs.readFileSync(votesDbPath, 'utf8');
      if (fileData.trim()) {
        return JSON.parse(fileData);
      }
    }
  } catch (error) {
    console.error('[VotesDB] Failed to load votes registry:', error);
  }
  return {};
};

// Helper to save persistent votes
const saveVotesRegistry = (registry) => {
  try {
    fs.writeFileSync(votesDbPath, JSON.stringify(registry, null, 2), 'utf8');
  } catch (error) {
    console.error('[VotesDB] Failed to save votes registry:', error);
  }
};

const voteRegistry = loadVotesRegistry();
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
    
    // 4. Cleanup session memory (video title/channel metadata stays persisted for analytics)
    delete sessionFactChecks[videoId];
  }
};

function shouldSkipVideoBasedOnMetadata(metadata) {
  if (!metadata) return false;
  const title = (metadata.title || '').toLowerCase();
  const channel = (metadata.channel || '').toLowerCase();
  
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

    // Join room
    socket.on('join_video', async (data) => {
      const videoId = typeof data === 'string' ? data : data.videoId;
      const metadata = typeof data === 'object' ? data.metadata : null;

      if (metadata && metadata.title) {
        setVideoMetadata(videoId, { title: metadata.title, channel: metadata.channel || '' });
      }

      console.log(`[Socket] ${socket.id} joined video: ${videoId}`);
      socket.join(videoId);

      if (shouldSkipVideoBasedOnMetadata(metadata)) {
        socket.skipFactChecking = true;
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
        const factCheckId = previousState.factCheckId || `fc_${videoId}_late`;
        const votes = voteRegistry[factCheckId] || { likes: 0, dislikes: 0, reasons: { inaccurate: 0, missing_context: 0, wrong_analysis: 0, other: 0 } };
        
        socket.emit('factcheck_update', {
          type: 'done',
          text: previousState.lastFactCheck,
          factCheckId: factCheckId,
          likes: votes.likes || 0,
          dislikes: votes.dislikes || 0,
          reasons: votes.reasons,
          isLatecomer: true
        });
      }

      subscribeToRedisChannel(io, videoId);
    });
    
    // Time update
    socket.on('video_time_update', (data) => {
      if (socket.skipFactChecking) return;

      if (data && data.videoId && typeof data.currentTime === 'number') {
        handleTimeUpdate(socket.id, data.videoId, data.currentTime).catch(err => {
          console.error('[Socket] Error handling time update:', err);
        });
      }
    });

    // Handle structured Like/Dislike votes (action: 'add' | 'remove' | 'switch')
    socket.on('vote_factcheck', (voteData) => {
      const {
        factCheckId, voteType, videoId, topic, verdict,
        reasonType, comment, action = 'add', previousVoteType
      } = voteData;
      if (!factCheckId) return;

      const registry = loadVotesRegistry();
      if (!registry[factCheckId]) {
        registry[factCheckId] = {
          factCheckId,
          videoId: videoId || 'unknown',
          topic: topic || 'N/A',
          realtimeVerdict: verdict || 'N/A',
          likes: 0,
          dislikes: 0,
          reasons: {
            inaccurate: 0,
            missing_context: 0,
            wrong_analysis: 0,
            other: 0
          },
          comments: [],
          lastVoted: new Date().toISOString()
        };
      }

      const rec = registry[factCheckId];

      const incrementCounter = (type, rType) => {
        if (type === 'like') rec.likes++;
        else if (type === 'dislike') rec.dislikes++;
        else if (type === 'reason' && rType && rec.reasons[rType] !== undefined) rec.reasons[rType]++;
      };

      const decrementCounter = (type, rType) => {
        if (type === 'like') rec.likes = Math.max(0, rec.likes - 1);
        else if (type === 'dislike') rec.dislikes = Math.max(0, rec.dislikes - 1);
        else if (type === 'reason' && rType && rec.reasons[rType] !== undefined) {
          rec.reasons[rType] = Math.max(0, rec.reasons[rType] - 1);
        }
      };

      if (action === 'remove') {
        // Undo a vote — decrement with floor at 0, never append comment
        decrementCounter(voteType, reasonType);
      } else if (action === 'switch') {
        // Switch like <-> dislike — decrement previous, increment new, no comment
        decrementCounter(previousVoteType, null);
        incrementCounter(voteType, reasonType);
      } else {
        // 'add' — default, back-compat behavior
        incrementCounter(voteType, reasonType);
        if (voteType === 'reason' && comment && comment.trim().length > 0) {
          rec.comments.push({
            text: comment.trim(),
            timestamp: new Date().toISOString()
          });
        }
      }

      rec.lastVoted = new Date().toISOString();
      voteRegistry[factCheckId] = rec; // Sync local memory copy
      saveVotesRegistry(registry);

      console.log(`[Vote] ${factCheckId} (${action}) updated: Likes=${rec.likes}, Dislikes=${rec.dislikes}`);

      // Broadcast vote update with reasons and counts
      io.to(videoId).emit('vote_update', {
        factCheckId,
        likes: rec.likes,
        dislikes: rec.dislikes,
        reasons: rec.reasons
      });
    });

    socket.on('leave_video', (videoId) => {
      console.log(`[Socket] ${socket.id} left video: ${videoId}`);
      socket.leave(videoId);
      setTimeout(() => {
        handleRoomEmpty(io, videoId);
      }, 100);
    });

    socket.on('disconnecting', () => {
      const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
      for (const roomId of rooms) {
        setTimeout(() => {
          handleRoomEmpty(io, roomId);
        }, 100);
      }
    });

    socket.on('disconnect', () => {
      removeClient(socket.id);
    });
  });
};

const subscribeToRedisChannel = (io, videoId) => {
  const channelName = `factcheck:${videoId}`;
  
  if (activeSubscriptions.has(channelName)) return;
  activeSubscriptions.add(channelName);
  
  subscribe(channelName, (message) => {
    if (message.factCheckId) {
      const votes = voteRegistry[message.factCheckId] || { likes: 0, dislikes: 0, reasons: { inaccurate: 0, missing_context: 0, wrong_analysis: 0, other: 0 } };
      message.likes = votes.likes || 0;
      message.dislikes = votes.dislikes || 0;
      message.reasons = votes.reasons;

      if (message.type === 'done') {
        if (!sessionFactChecks[videoId]) {
          sessionFactChecks[videoId] = [];
        }
        const parsedFc = parseFactCheckMessage(message.text, message.factCheckId);
        if (!sessionFactChecks[videoId].some(fc => fc.id === parsedFc.id)) {
          sessionFactChecks[videoId].push(parsedFc);
        }
      }
    }
    io.to(videoId).emit('factcheck_update', message);
  });
};

/**
 * Returns sorted list of controversial claims with vote breakdown (For Admin API)
 */
export const getVotingAnalytics = () => {
  const registry = loadVotesRegistry();
  return Object.values(registry)
    .sort((a, b) => b.dislikes - a.dislikes); // Most disliked first
};

/**
 * Reset vote counters for a specific claim
 */
export const resetVotes = (factCheckId, io) => {
  const registry = loadVotesRegistry();
  if (registry[factCheckId]) {
    const videoId = registry[factCheckId].videoId;
    registry[factCheckId].likes = 0;
    registry[factCheckId].dislikes = 0;
    registry[factCheckId].reasons = { inaccurate: 0, missing_context: 0, wrong_analysis: 0, other: 0 };
    registry[factCheckId].comments = [];
    registry[factCheckId].lastVoted = new Date().toISOString();
    
    voteRegistry[factCheckId] = registry[factCheckId]; // Sync memory
    saveVotesRegistry(registry);

    // Broadcast reset to clients currently viewing
    if (io && videoId) {
      io.to(videoId).emit('vote_update', {
        factCheckId,
        likes: 0,
        dislikes: 0,
        reasons: registry[factCheckId].reasons
      });
    }
    return true;
  }
  return false;
};

/**
 * Deletes a card from active room latecomer states and broadcasts deletion request to all viewers
 */
export const deleteCardFromRoomState = async (factCheckId, io) => {
  const registry = loadVotesRegistry();
  const videoId = registry[factCheckId] ? registry[factCheckId].videoId : null;

  if (videoId) {
    const stateKey = `state:${videoId}`;
    const previousState = await getState(stateKey);
    
    // Clear latecomer state in Redis if it contains this card
    if (previousState && previousState.lastFactCheck && previousState.lastFactCheck.includes(factCheckId)) {
      await saveState(stateKey, null);
      console.log(`[Socket] Cleared Redis latecomer state for room: ${videoId}`);
    }

    // Broadcast deletion to all connected clients in the room
    if (io) {
      io.to(videoId).emit('factcheck_delete', { factCheckId });
      console.log(`[Socket] Emitted deletion signal for card: ${factCheckId}`);
    }
    return true;
  }
  return false;
};
