import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const parseCsv = (value) => String(value || '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);

const getGeminiApiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

export const config = {
  port: process.env.PORT || 3000,
  gemini: {
    apiKey: getGeminiApiKey(),
    // Primary/default Gemini model. VOD extractor fallback order is configurable via VOD_EXTRACTOR_MODELS.
    model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
    vodExtractorModels: parseCsv(process.env.VOD_EXTRACTOR_MODELS),
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
