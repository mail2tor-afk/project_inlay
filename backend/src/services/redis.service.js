import Redis from 'ioredis';
import { config } from '../config/index.js';

let redisClient = null;
let redisPublisher = null;
let redisSubscriber = null;

// Initialize Redis Connections
export const initRedis = () => {
  if (!config.redis.url) {
    console.warn('[Redis] No REDIS_URL provided. Operating in mock mode.');
    return;
  }

  try {
    // Standard client for basic KV ops
    redisClient = new Redis(config.redis.url);
    
    // Publisher client (pub/sub needs separate connections)
    redisPublisher = new Redis(config.redis.url);
    
    // Subscriber client
    redisSubscriber = new Redis(config.redis.url);

    redisClient.on('connect', () => console.log('[Redis] Connected successfully'));
    redisClient.on('error', (err) => console.error('[Redis] Connection Error:', err));
  } catch (error) {
    console.error('[Redis] Initialization Error:', error);
  }
};

// Publish a message to a channel
export const publish = async (channel, message) => {
  if (redisPublisher) {
    await redisPublisher.publish(channel, JSON.stringify(message));
  } else {
    console.log(`[Redis Mock] Publish to ${channel}:`, message);
  }
};

// Subscribe to a channel
export const subscribe = (channel, callback) => {
  if (redisSubscriber) {
    redisSubscriber.subscribe(channel, (err, count) => {
      if (err) {
        console.error(`[Redis] Failed to subscribe to ${channel}:`, err);
      } else {
        console.log(`[Redis] Subscribed to ${channel}`);
      }
    });

    redisSubscriber.on('message', (chan, message) => {
      if (chan === channel) {
        try {
          callback(JSON.parse(message));
        } catch (e) {
          callback(message);
        }
      }
    });
  } else {
    console.log(`[Redis Mock] Subscribed to ${channel}`);
  }
};

// Save Latecomer state (Caching latest factcheck/poll)
export const saveState = async (key, data, ttlSeconds = 3600) => {
  if (redisClient) {
    await redisClient.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  }
};

// Get Latecomer state
export const getState = async (key) => {
  if (redisClient) {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  }
  return null;
};
