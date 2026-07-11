import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

import { config } from './config/index.js';
import { initRedis } from './services/redis.service.js';
import { initRag } from './services/rag.service.js';
import { initLLM, getFactCheckPrompt, updatePromptConfig, resetPromptConfig, testPromptFactCheck, DEFAULT_FACT_CHECK_PROMPT } from './services/llm.service.js';
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

// HTTP Endpoint to export all backend factcheck history
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const historyFilePath = path.join(__dirname, '../factchecks_history.json');

app.get('/api/factchecks/export', (req, res) => {
  try {
    if (fs.existsSync(historyFilePath)) {
      const fileContent = fs.readFileSync(historyFilePath, 'utf8');
      res.setHeader('Content-disposition', 'attachment; filename=factchecks_export.json');
      res.setHeader('Content-type', 'application/json');
      return res.status(200).send(fileContent);
    } else {
      res.setHeader('Content-disposition', 'attachment; filename=factchecks_export.json');
      res.setHeader('Content-type', 'application/json');
      return res.status(200).send(JSON.stringify([], null, 2));
    }
  } catch (error) {
    console.error('[Server] Export failed:', error);
    res.status(500).json({ error: 'Export failed: ' + error.message });
  }
});

// GET current and default prompts
app.get('/api/prompt', (req, res) => {
  try {
    const current = getFactCheckPrompt();
    res.json({
      currentPrompt: current,
      defaultPrompt: DEFAULT_FACT_CHECK_PROMPT
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST save a new custom prompt
app.post('/api/prompt', (req, res) => {
  const { prompt } = req.body;
  try {
    const result = updatePromptConfig(prompt);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST reset custom prompt back to default
app.post('/api/prompt/reset', (req, res) => {
  try {
    const result = resetPromptConfig();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST test a prompt against custom data
app.post('/api/prompt/test', async (req, res) => {
  const { prompt, transcript, context } = req.body;
  if (!prompt || !transcript) {
    return res.status(400).json({ error: 'Missing prompt or transcript text' });
  }
  try {
    const resultText = await testPromptFactCheck(prompt, transcript, context);
    res.json({ result: resultText });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET list history samples to test against in the UI
app.get('/api/factchecks/history-samples', (req, res) => {
  try {
    if (fs.existsSync(historyFilePath)) {
      const fileContent = fs.readFileSync(historyFilePath, 'utf8');
      if (fileContent.trim()) {
        const history = JSON.parse(fileContent);
        // Only return the last 15 items to avoid blowing up payload size
        const samples = history.slice(-15).map(item => ({
          id: item.id,
          videoId: item.videoId,
          timestamp: item.timestamp,
          transcript: item.transcript,
          context: item.context
        }));
        return res.json(samples.reverse()); // newest first
      }
    }
    res.json([]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve Admin UI Static Files
app.use(express.static(path.join(__dirname, '../public')));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Start Server
const PORT = config.port || 3000;
httpServer.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
});
