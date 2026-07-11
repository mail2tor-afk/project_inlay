import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';

let supabase = null;
let genAI = null;

export const initRag = () => {
  if (config.supabase.url && config.supabase.serviceKey) {
    supabase = createClient(config.supabase.url, config.supabase.serviceKey);
    console.log('[RAG] Supabase client initialized');
  } else {
    console.warn('[RAG] Supabase credentials missing. Operating in mock mode.');
  }

  if (config.gemini.apiKey) {
    genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  }
};

/**
 * Generate embedding for text using Gemini text-embedding-004
 */
export const generateEmbedding = async (text) => {
  if (!genAI) return new Array(768).fill(0); // Mock embedding

  try {
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error('[RAG] Error generating embedding:', error);
    return null;
  }
};

/**
 * Perform Similarity Search in Supabase (pgvector)
 */
export const similaritySearch = async (queryText, similarityThreshold = 0.9, matchCount = 3) => {
  if (!supabase) {
    console.log('[RAG Mock] Similarity search for:', queryText);
    // Mock zero-latency fallback
    if (queryText.includes('mock exact match')) {
      return [{
        content: 'This is a mock cached fact-check result.',
        similarity: 0.95
      }];
    }
    return [];
  }

  try {
    const queryEmbedding = await generateEmbedding(queryText);
    if (!queryEmbedding) return [];

    // Assuming a Supabase RPC function named 'match_documents' is created in the database
    /*
      SQL for Supabase:
      create or replace function match_documents (
        query_embedding vector(768),
        match_threshold float,
        match_count int
      )
      returns table (
        id bigint,
        content text,
        similarity float
      )
    */
    const { data, error } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: similarityThreshold,
      match_count: matchCount,
    });

    if (error) {
      console.error('[RAG] Supabase RPC error:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('[RAG] Similarity search error:', error);
    return [];
  }
};
