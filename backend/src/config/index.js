import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    // NOTE: 'gemini-3.1-flash' ไม่มีใน ListModels ของ key นี้ (404) — ใช้ flash stable ล่าสุดแทน
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    groundingEnabled: process.env.GEMINI_GROUNDING !== 'false',
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
  },
  redis: {
    url: process.env.REDIS_URL,
  }
};
