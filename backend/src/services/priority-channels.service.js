import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeChannelName, listVideoMetadata } from './video-metadata.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const storeFilePath = path.join(__dirname, '../../priority_channels.json');

// normalizedChannelName -> { channelName, addedAt }
let store = new Map();

const loadStore = () => {
  try {
    if (fs.existsSync(storeFilePath)) {
      const raw = fs.readFileSync(storeFilePath, 'utf8');
      if (raw.trim()) {
        store = new Map(Object.entries(JSON.parse(raw)));
        console.log(`[PriorityChannels] Loaded ${store.size} priority channels`);
      }
    }
  } catch (err) {
    console.error('[PriorityChannels] Failed to load priority_channels.json:', err.message);
  }
};
loadStore();

const persistStore = () => {
  try {
    fs.writeFileSync(storeFilePath, JSON.stringify(Object.fromEntries(store), null, 2), 'utf8');
  } catch (err) {
    console.error('[PriorityChannels] Failed to persist priority_channels.json:', err.message);
  }
};

export const addPriorityChannel = (channelName) => {
  const trimmed = (channelName || '').trim();
  if (!trimmed) return { success: false, error: 'ชื่อช่องว่างเปล่า' };

  const key = normalizeChannelName(trimmed);
  if (store.has(key)) {
    return { success: true, alreadyExists: true };
  }

  store.set(key, { channelName: trimmed, addedAt: Date.now() });
  persistStore();
  return { success: true, alreadyExists: false };
};

export const removePriorityChannel = (channelName) => {
  const key = normalizeChannelName(channelName);
  const existed = store.delete(key);
  if (existed) persistStore();
  return existed;
};

export const listPriorityChannels = () =>
  Array.from(store.values()).sort((a, b) => a.channelName.localeCompare(b.channelName, 'th'));

// เทียบรายชื่อช่องสำคัญกับ video_metadata.json เพื่อบอกว่าช่องไหนมีข้อมูล fact-check อยู่แล้วบ้าง
export const listPriorityChannelsWithCoverage = () => {
  const countsByChannel = new Map();
  for (const v of listVideoMetadata()) {
    const key = normalizeChannelName(v.channel);
    if (!key) continue;
    countsByChannel.set(key, (countsByChannel.get(key) || 0) + 1);
  }

  return listPriorityChannels().map((pc) => {
    const videoCount = countsByChannel.get(normalizeChannelName(pc.channelName)) || 0;
    return { ...pc, videoCount, hasData: videoCount > 0 };
  });
};
