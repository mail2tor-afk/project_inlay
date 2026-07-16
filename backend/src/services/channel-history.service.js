import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getVideoMetadata, listVideoMetadata, normalizeChannelName } from './video-metadata.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const historyFilePath = path.join(__dirname, '../../factchecks_history.json');

// videoId -> ข้อความสรุปประวัติช่อง (คำนวณครั้งเดียวต่อวิดีโอ ไม่รีเฟรชระหว่าง session - reset เมื่อ server restart)
const channelHistoryCache = new Map();

const TOP_TOPICS = 5;
const TOP_SPEAKERS = 3;
const PLACEHOLDER_SPEAKER = /^ไม่ระบุ/;

const readHistory = () => {
  try {
    if (fs.existsSync(historyFilePath)) {
      const raw = fs.readFileSync(historyFilePath, 'utf8');
      if (raw.trim()) return JSON.parse(raw);
    }
  } catch (err) {
    console.error('[ChannelHistory] Failed to read factchecks_history.json:', err.message);
  }
  return [];
};

const topN = (values, n) => {
  const counts = new Map();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
};

const buildChannelHistoryProfile = (records) => {
  const topics = topN(
    records.map((r) => r.parsed?.topic).filter(Boolean),
    TOP_TOPICS
  );

  const speakers = topN(
    records
      .map((r) => r.parsed?.speaker)
      .filter(Boolean)
      .map((s) => s.replace(/\s*\(.*?\)\s*$/, '').trim())
      .filter((s) => s && !PLACEHOLDER_SPEAKER.test(s)),
    TOP_SPEAKERS
  );

  if (topics.length === 0 && speakers.length === 0) return '';

  const lines = [];
  if (topics.length > 0) {
    lines.push(`หัวข้อที่เคยพูดถึงบ่อยในช่องนี้: ${topics.map(([t, c]) => `${t} (${c})`).join(', ')}`);
  }
  if (speakers.length > 0) {
    lines.push(`บุคคลที่เคยถูกกล่าวถึงบ่อยในช่องนี้: ${speakers.map(([s, c]) => `${s} (${c})`).join(', ')}`);
  }
  return lines.join('\n');
};

export const getChannelHistoryContext = (videoId) => {
  if (channelHistoryCache.has(videoId)) {
    return channelHistoryCache.get(videoId);
  }

  const meta = getVideoMetadata(videoId);
  const channelKey = normalizeChannelName(meta?.channel);
  if (!channelKey) {
    channelHistoryCache.set(videoId, '');
    return '';
  }

  const sameChannelVideoIds = new Set(
    listVideoMetadata()
      .filter((v) => normalizeChannelName(v.channel) === channelKey)
      .map((v) => v.videoId)
  );

  const history = readHistory();
  const records = history.filter((r) => sameChannelVideoIds.has(r.videoId));

  const profile = buildChannelHistoryProfile(records);
  channelHistoryCache.set(videoId, profile);
  return profile;
};
