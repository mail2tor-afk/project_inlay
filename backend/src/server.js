import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

import { config } from './config/index.js';
import { initRedis } from './services/redis.service.js';
import { initRag } from './services/rag.service.js';
import { initLLM } from './services/llm.service.js';
import { processTranscriptChunk } from './services/triage.service.js';
import { setupSocketHandlers } from './sockets/broadcast.handler.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // Allow all origins for the Chrome Extension
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Services
initRedis();
initRag();
initLLM();

// Setup WebSocket Handlers
setupSocketHandlers(io);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// Diagnostic endpoint to receive logs from Content Scripts
app.post('/api/debug', (req, res) => {
  const { level, msg, data } = req.body;
  console.log(`[Frontend Debug][${level.toUpperCase()}] ${msg}`, data ? JSON.stringify(data) : '');
  res.status(200).send();
});

// Endpoint to receive chunked transcript from the Extension (Master Listener)
app.post('/api/transcript/chunk', async (req, res) => {
  const { videoId, text, timestamp } = req.body;
  
  if (!videoId || !text) {
    return res.status(400).json({ error: 'Missing videoId or text' });
  }

  // We do NOT await processTranscriptChunk here. We return 202 Accepted immediately
  // and process it in the background to free up the HTTP connection.
  processTranscriptChunk(videoId, text, timestamp).catch(err => {
    console.error('[API] Error processing chunk async:', err);
  });

  res.status(202).json({ status: 'accepted' });
});

// Start Server
const PORT = config.port || 3000;
httpServer.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
});
