import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheFilePath = path.join(__dirname, '../../factchecks_cache.json');

// key -> { result: 'SKIP' | string, timestamp }
let cacheStore = new Map();

// จัดกลุ่มตามช่วงเวลาเริ่ม chunk (ไม่ใช่ hash ข้อความตรงตัว) เพราะสอง session ที่ดูวิดีโอเดียวกัน
// คนละรอบ/คนละวัน จะไม่มีวัน tick เวลาตรงกันเป๊ะ แต่จะเริ่ม chunk ใกล้เคียงกันมาก (คลาดเคลื่อนไม่กี่วินาที)
const CACHE_BUCKET_SECONDS = 10;

const loadCache = () => {
  try {
    if (fs.existsSync(cacheFilePath)) {
      const raw = fs.readFileSync(cacheFilePath, 'utf8');
      if (raw.trim()) {
        cacheStore = new Map(Object.entries(JSON.parse(raw)));
        console.log(`[Cache] Loaded ${cacheStore.size} persistent fact-check entries`);
      }
    }
  } catch (err) {
    console.error('[Cache] Failed to load persistent cache:', err.message);
  }
};
loadCache();

const persistCache = () => {
  try {
    fs.writeFileSync(cacheFilePath, JSON.stringify(Object.fromEntries(cacheStore), null, 2), 'utf8');
  } catch (err) {
    console.error('[Cache] Failed to persist cache:', err.message);
  }
};

const makeCacheKey = (videoId, chunkStartTime) => {
  const bucket = Math.floor((chunkStartTime || 0) / CACHE_BUCKET_SECONDS);
  return `${videoId}:${bucket}`;
};

/**
 * คืนค่า: undefined = ไม่เคยเช็ค chunk นี้ของวิดีโอนี้มาก่อน (ต้องยิง AI)
 *         'SKIP'    = เคยเช็คแล้ว AI ตัดสินว่าไม่มีประเด็นต้องแจ้ง
 *         string    = ผลฟันธงที่เคยส่งให้ผู้ชมไปแล้ว (นำมา broadcast ซ้ำได้เลย ไม่ต้องยิง AI)
 */
export const getCachedResult = (videoId, chunkStartTime) => {
  const entry = cacheStore.get(makeCacheKey(videoId, chunkStartTime));
  return entry ? entry.result : undefined;
};

export const setCachedResult = (videoId, chunkStartTime, result) => {
  cacheStore.set(makeCacheKey(videoId, chunkStartTime), { result, timestamp: Date.now() });
  persistCache();
};
