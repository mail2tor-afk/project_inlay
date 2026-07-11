import { subscribe, getState } from '../services/redis.service.js';

const activeSubscriptions = new Set();

export const setupSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    console.log(`[Socket] User connected: ${socket.id}`);

    // Join a room for a specific video
    socket.on('join_video', async (videoId) => {
      console.log(`[Socket] ${socket.id} joined video: ${videoId}`);
      socket.join(videoId);

      // Latecomer state retrieval
      const stateKey = `state:${videoId}`;
      const previousState = await getState(stateKey);
      
      if (previousState) {
        console.log(`[Socket] Sending latecomer state to ${socket.id}`);
        socket.emit('factcheck_update', {
          type: 'done',
          text: previousState.lastFactCheck,
          isLatecomer: true
        });
      }

      // Ensure we have a Redis subscription for this video
      subscribeToRedisChannel(io, videoId);
    });

    socket.on('leave_video', (videoId) => {
      console.log(`[Socket] ${socket.id} left video: ${videoId}`);
      socket.leave(videoId);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] User disconnected: ${socket.id}`);
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
    io.to(videoId).emit('factcheck_update', message);
  });
};
