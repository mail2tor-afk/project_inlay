import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

import { config } from './config/index.js';
import { initRedis } from './services/redis.service.js';
import { initRag } from './services/rag.service.js';
import { initLLM, getFactCheckPrompt, updatePromptConfig, resetPromptConfig, testPromptFactCheck, DEFAULT_FACT_CHECK_PROMPT } from './services/llm.service.js';
import { processTranscriptChunk } from './services/triage.service.js';
import { setupSocketHandlers, getVotingAnalytics, resetVotes, deleteCardFromRoomState } from './sockets/broadcast.handler.js';
import { getAuditReports, resolveAuditReport } from './services/audit.service.js';
import { addDocumentToRag, getRagDocuments, deleteDocumentFromRag } from './services/rag.service.js';
import { scrapeNewsLink, runAutoFactCheckScraper } from './services/scraper.service.js';
import { getCachedTranscript } from './services/transcript.service.js';
import { getVideoMetadata } from './services/video-metadata.service.js';
import { addPriorityChannel, removePriorityChannel, listPriorityChannelsWithCoverage } from './services/priority-channels.service.js';

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
  const { prompt, transcript, context, channelHistory } = req.body;
  if (!prompt || !transcript) {
    return res.status(400).json({ error: 'Missing prompt or transcript text' });
  }
  try {
    const resultText = await testPromptFactCheck(prompt, transcript, context, '', channelHistory);
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

// GET list of audit reports
// ส่งเฉพาะรายการล่าสุด (จำกัดจำนวน) ป้องกัน payload/DOM บวมเมื่อคลิปสะสมเยอะขึ้นเรื่อยๆ
// ไฟล์ factchecks_audit_reports.json เก็บทุกรายการเหมือนเดิม แค่ไม่ส่งทั้งหมดในคราวเดียว
app.get('/api/factchecks/audit-reports', (req, res) => {
  try {
    const reports = getAuditReports();
    const sorted = [...reports].sort((a, b) => new Date(b.auditTimestamp) - new Date(a.auditTimestamp));
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
    res.json({
      reports: sorted.slice(0, limit),
      totalCount: reports.length,
      unresolvedCount: reports.filter(r => !r.resolved).length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST resolve/dismiss an audit report
app.post('/api/factchecks/audit-reports/resolve', (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing report ID' });
  }
  try {
    const success = resolveAuditReport(id);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET RAG documents
app.get('/api/rag/documents', (req, res) => {
  try {
    const docs = getRagDocuments();
    res.json(docs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST quick-fact
app.post('/api/rag/quick-fact', async (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Missing title or content' });
  }
  try {
    const result = await addDocumentToRag(title, content, 'quick-fact');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST paste-link
app.post('/api/rag/paste-link', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing URL' });
  }
  try {
    const result = await scrapeNewsLink(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE RAG document
app.delete('/api/rag/documents/:id', (req, res) => {
  const { id } = req.params;
  try {
    const success = deleteDocumentFromRag(id);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST trigger auto scraper
app.post('/api/rag/trigger-scrape', async (req, res) => {
  try {
    const result = await runAutoFactCheckScraper();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET voting analytics
app.get('/api/factchecks/voting-analytics', (req, res) => {
  try {
    const analytics = getVotingAnalytics();
    const enriched = analytics.map(record => {
      const meta = getVideoMetadata(record.videoId);
      return {
        ...record,
        videoTitle: meta?.title || '(ไม่มีข้อมูล metadata)',
        videoChannel: meta?.channel || ''
      };
    });
    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST reset votes
app.post('/api/factchecks/votes/reset', (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing claim ID' });
  }
  try {
    const success = resetVotes(id, io);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST delete card from state
app.post('/api/factchecks/state/delete', async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing card/claim ID' });
  }
  try {
    const success = await deleteCardFromRoomState(id, io);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET active sessions & transcripts
app.get('/api/active-sessions', (req, res) => {
  try {
    const rooms = Array.from(io.sockets.adapter.rooms.keys());
    const activeVideos = rooms.filter(roomId => {
      const isSocketRoom = io.sockets.sockets.has(roomId);
      return !isSocketRoom && roomId.length === 11;
    });

    const sessions = activeVideos.map(videoId => {
      const room = io.sockets.adapter.rooms.get(videoId);
      const meta = getVideoMetadata(videoId);
      return {
        videoId,
        activeViewers: room ? room.size : 0,
        transcript: getCachedTranscript(videoId),
        title: meta?.title || '(ไม่มีข้อมูล metadata)',
        channel: meta?.channel || ''
      };
    });

    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET priority channels (พร้อมสถานะว่ามีข้อมูล fact-check อยู่แล้วกี่คลิป)
app.get('/api/priority-channels', (req, res) => {
  try {
    res.json(listPriorityChannelsWithCoverage());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST add priority channel
app.post('/api/priority-channels', (req, res) => {
  const { channelName } = req.body;
  if (!channelName || !channelName.trim()) {
    return res.status(400).json({ error: 'Missing channelName' });
  }
  try {
    const result = addPriorityChannel(channelName);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE priority channel
app.delete('/api/priority-channels/:channelName', (req, res) => {
  try {
    const success = removePriorityChannel(req.params.channelName);
    res.json({ success });
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
