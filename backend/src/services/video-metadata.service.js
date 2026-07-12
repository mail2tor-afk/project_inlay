import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const metaFilePath = path.join(__dirname, '../../video_metadata.json');

// videoId -> { title, channel, firstSeen, lastSeen }
// เก็บถาวรลงดิสก์ (ต่างจาก Live Sessions ที่หายไปเมื่อห้องว่าง) เพราะ Voting Analytics
// ต้องใช้ชื่อช่อง/ชื่อคลิปได้แม้คนดูออกจากห้องหรือ server restart ไปแล้ว
let store = new Map();

const loadStore = () => {
  try {
    if (fs.existsSync(metaFilePath)) {
      const raw = fs.readFileSync(metaFilePath, 'utf8');
      if (raw.trim()) {
        store = new Map(Object.entries(JSON.parse(raw)));
        console.log(`[VideoMeta] Loaded metadata for ${store.size} videos`);
      }
    }
  } catch (err) {
    console.error('[VideoMeta] Failed to load video_metadata.json:', err.message);
  }
};
loadStore();

const persistStore = () => {
  try {
    fs.writeFileSync(metaFilePath, JSON.stringify(Object.fromEntries(store), null, 2), 'utf8');
  } catch (err) {
    console.error('[VideoMeta] Failed to persist video_metadata.json:', err.message);
  }
};

export const setVideoMetadata = (videoId, { title, channel } = {}) => {
  if (!videoId || !title) return;
  const existing = store.get(videoId);
  store.set(videoId, {
    title,
    channel: channel || existing?.channel || '',
    firstSeen: existing?.firstSeen || Date.now(),
    lastSeen: Date.now(),
  });
  persistStore();
};

export const getVideoMetadata = (videoId) => store.get(videoId) || null;

export const listVideoMetadata = () => Array.from(store.entries()).map(([videoId, meta]) => ({ videoId, ...meta }));

// trim + collapse whitespace - ใช้เทียบชื่อช่องข้าม feature (priority channels, channel history)
// เพื่อกัน "Bright TV" กับ "Bright  TV " ถูกนับเป็นคนละช่อง
export const normalizeChannelName = (name) => (name || '').trim().replace(/\s+/g, ' ');
