import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localRagDbPath = path.resolve(__dirname, '../../local_rag_db.json');

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
 * Generate embedding for text using Gemini gemini-embedding-001
 * (text-embedding-004 / embedding-001 no longer exist on the current API version - confirmed via ListModels)
 */
export const generateEmbedding = async (text) => {
  if (!genAI) {
    console.warn('[RAG] Gemini not initialized - cannot generate embedding');
    return null;
  }

  try {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
      const result = await model.embedContent(text);
      return result.embedding.values;
    } catch (e1) {
      console.warn(`[RAG] gemini-embedding-001 failed (${e1.message}), falling back to gemini-embedding-2...`);
      const model = genAI.getGenerativeModel({ model: 'gemini-embedding-2' });
      const result = await model.embedContent(text);
      return result.embedding.values;
    }
  } catch (error) {
    console.error('[RAG] Error generating embedding with all models:', error);
    return null;
  }
};

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Perform Similarity Search in Supabase (pgvector) or local JSON Vector store fallback
 */
export const similaritySearch = async (queryText, similarityThreshold = 0.7, matchCount = 3) => {
  try {
    const queryEmbedding = await generateEmbedding(queryText);
    if (!queryEmbedding) return [];

    // Supabase pgvector search
    if (supabase) {
      const { data, error } = await supabase.rpc('match_documents', {
        query_embedding: queryEmbedding,
        match_threshold: similarityThreshold,
        match_count: matchCount,
      });

      if (!error && data) return data;
      console.warn('[RAG] Supabase RPC failed or missing, falling back to local search:', error);
    }

    // Local JSON Vector store search fallback
    console.log('[RAG Local] Performing local Cosine Similarity search for:', queryText.substring(0, 40) + '...');
    const documents = getRagDocuments();
    if (documents.length === 0) return [];

    const scored = documents.map(doc => {
      const sim = cosineSimilarity(queryEmbedding, doc.embedding);
      return {
        id: doc.id,
        content: doc.content,
        title: doc.title,
        type: doc.type,
        similarity: sim
      };
    });

    // Sort descending, filter above threshold, return top matchCount
    return scored
      .filter(doc => doc.similarity >= similarityThreshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, matchCount);

  } catch (error) {
    console.error('[RAG] Similarity search error:', error);
    return [];
  }
};

/**
 * Add document text to the RAG database (splitting into chunks & generating embeddings)
 */
export const addDocumentToRag = async (title, content, type = 'text') => {
  if (!content || content.trim().length === 0) return null;

  // Split into chunks of approx 300 characters
  const chunks = [];
  let index = 0;
  const chunkSize = 300;
  while (index < content.length) {
    chunks.push(content.slice(index, index + chunkSize).trim());
    index += chunkSize;
  }

  console.log(`[RAG] Split "${title}" into ${chunks.length} chunks. Generating embeddings...`);
  const documents = getRagDocuments();

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = await generateEmbedding(chunk);
    if (!embedding) continue;

    const docId = `rag_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newDoc = {
      id: docId,
      title: `${title} (ส่วนที่ ${i + 1}/${chunks.length})`,
      content: chunk,
      embedding,
      type,
      createdAt: new Date().toISOString()
    };

    // Save locally
    documents.push(newDoc);
  }

  saveLocalRagDb(documents);
  return { success: true, count: chunks.length };
};

/**
 * Retrieve all documents stored in RAG (specifically for admin display)
 */
export const getRagDocuments = () => {
  try {
    if (fs.existsSync(localRagDbPath)) {
      const fileData = fs.readFileSync(localRagDbPath, 'utf8');
      if (fileData.trim()) {
        return JSON.parse(fileData);
      }
    }
  } catch (error) {
    console.error('[RAG] Failed to read local RAG database:', error);
  }
  return [];
};

/**
 * Delete a document from RAG by ID
 */
export const deleteDocumentFromRag = (id) => {
  try {
    const documents = getRagDocuments();
    const filtered = documents.filter(doc => doc.id !== id);
    saveLocalRagDb(filtered);
    console.log(`[RAG] Deleted document: ${id}`);
    return true;
  } catch (error) {
    console.error('[RAG] Failed to delete document:', error);
    return false;
  }
};

const saveLocalRagDb = (documents) => {
  try {
    fs.writeFileSync(localRagDbPath, JSON.stringify(documents, null, 2), 'utf8');
    console.log(`[RAG] Saved local vector DB to: ${localRagDbPath}`);
  } catch (error) {
    console.error('[RAG] Failed to save local vector DB:', error);
  }
};
