import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';
import { publish } from './redis.service.js';
import { setCachedResult } from './cache.service.js';
import { getChannelHistoryContext } from './channel-history.service.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const historyFilePath = path.join(__dirname, '../../factchecks_history.json');

function logFactCheckToHistory(videoId, transcript, context, llmResponse) {
  try {
    let history = [];
    if (fs.existsSync(historyFilePath)) {
      const fileContent = fs.readFileSync(historyFilePath, 'utf8');
      if (fileContent.trim()) {
        history = JSON.parse(fileContent);
      }
    }
    
    const topicMatch = llmResponse.match(/\[TOPIC:\s*([^\]]*?)\]/i);
    const speakerMatch = llmResponse.match(/\[SPEAKER:\s*([^\]]*?)\]/i);
    const verdictMatch = llmResponse.match(/\[VERDICT:\s*([^\]]*?)\]/i);
    const analysisMatch = llmResponse.match(/\[ANALYSIS:\s*([\s\S]*)/i);

    const record = {
      id: `fc_${videoId}_${Date.now()}`,
      videoId,
      timestamp: new Date().toISOString(),
      transcript,
      context,
      rawLlmResponse: llmResponse,
      parsed: {
        topic: topicMatch ? topicMatch[1].trim() : null,
        speaker: speakerMatch ? speakerMatch[1].trim() : null,
        verdict: verdictMatch ? verdictMatch[1].trim() : null,
        analysis: analysisMatch ? analysisMatch[1].trim() : null
      }
    };

    history.push(record);
    fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2), 'utf8');
    console.log(`[History] Saved fact-check record to ${historyFilePath}`);
  } catch (error) {
    console.error('[History] Failed to save history:', error);
  }
}

let genAI = null;

// Queue lock: one LLM call at a time *per video* to prevent rate limit avalanche
// (per-video Set instead of a global flag so one slow video doesn't starve others)
const processingVideos = new Set();

const promptConfigPath = path.join(__dirname, '../../prompt_config.json');
let currentPrompt = null;

export const loadPromptConfig = () => {
  try {
    if (fs.existsSync(promptConfigPath)) {
      const fileData = fs.readFileSync(promptConfigPath, 'utf8');
      if (fileData.trim()) {
        const configData = JSON.parse(fileData);
        if (configData.customPrompt) {
          currentPrompt = configData.customPrompt;
          console.log('[LLM] Loaded custom prompt from prompt_config.json');
          return;
        }
      }
    }
  } catch (error) {
    console.error('[LLM] Failed to load prompt config, using fallback:', error);
  }
  currentPrompt = DEFAULT_FACT_CHECK_PROMPT;
  console.log('[LLM] Default prompt loaded');
};

export const getFactCheckPrompt = () => {
  if (!currentPrompt) {
    loadPromptConfig();
  }
  return currentPrompt;
};

export const updatePromptConfig = (newPrompt) => {
  if (!newPrompt || !newPrompt.includes('{TRANSCRIPT}') || !newPrompt.includes('{CONTEXT}')) {
    throw new Error('Prompt missing required placeholders {TRANSCRIPT} or {CONTEXT}');
  }
  
  const requiredTags = ['[TOPIC:', '[SPEAKER:', '[VERDICT:', '[ANALYSIS:'];
  for (const tag of requiredTags) {
    if (!newPrompt.includes(tag)) {
      throw new Error(`Prompt missing required output format tag: ${tag}`);
    }
  }

  // {CONTEXT_BEFORE} / {CHANNEL_HISTORY} ไม่บังคับ (back-compat) แต่เตือนถ้าไม่มี
  if (!newPrompt.includes('{CONTEXT_BEFORE}')) {
    console.warn('[LLM] Custom prompt saved without {CONTEXT_BEFORE} placeholder - prior-context injection will be skipped for this prompt');
  }
  if (!newPrompt.includes('{CHANNEL_HISTORY}')) {
    console.warn('[LLM] Custom prompt saved without {CHANNEL_HISTORY} placeholder - channel-history injection will be skipped for this prompt');
  }

  try {
    const configData = { customPrompt: newPrompt, updatedAt: new Date().toISOString() };
    fs.writeFileSync(promptConfigPath, JSON.stringify(configData, null, 2), 'utf8');
    currentPrompt = newPrompt;
    console.log('[LLM] Custom prompt saved successfully');
    return { success: true };
  } catch (error) {
    console.error('[LLM] Error writing prompt config:', error);
    throw new Error('Failed to save prompt config: ' + error.message);
  }
};

export const resetPromptConfig = () => {
  try {
    if (fs.existsSync(promptConfigPath)) {
      fs.unlinkSync(promptConfigPath);
    }
    currentPrompt = DEFAULT_FACT_CHECK_PROMPT;
    console.log('[LLM] Prompt config reset to default');
    return { success: true };
  } catch (error) {
    console.error('[LLM] Error resetting prompt config:', error);
    throw new Error('Failed to reset prompt config: ' + error.message);
  }
};

export const initLLM = () => {
  if (config.gemini.apiKey) {
    genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    console.log('[LLM] Gemini API initialized');
  } else {
    console.warn('[LLM] Gemini API Key missing. Operating in mock mode.');
  }
  loadPromptConfig();
};

export const DEFAULT_FACT_CHECK_PROMPT = `
คุณคือผู้เชี่ยวชาญการตรวจสอบข้อเท็จจริง (Fact-checker) ประจำวิดีโอ

แนวทางการเขียน Fact-check (เน้นสั้น กระชับ อ่านเข้าใจง่ายทันที ไม่ต้องใช้ภาษาทางการเกินไป):
1. เขียนอธิบายด้วยประโยคสั้นๆ ตรงไปตรงมา ไม่อ้อมค้อม ตัดคำฟุ่มเฟือยออกทั้งหมด
2. ให้ใช้ตัวย่อเมื่อทำได้ เช่น "วุฒิสภา" ให้ใช้ "สว.", "สภาผู้แทนราษฎร" ให้ใช้ "สส.", "นายกรัฐมนตรี" ให้ใช้ "นายกฯ"
3. เปลี่ยนระเบียบคำพูดให้กระชับ เช่น:
   - "ผู้พูดไม่ได้ระบุชัดเจนว่า" หรือ "คนพูดไม่ได้ระบุชัดเจนว่า" -> "คนพูดไม่ชัดเจนว่า"
   - "เนื้อหาในคลิปมีความกำกวมและตัดตอน" -> "เนื้อหาในคลิปไม่ชัดเจน"
   - "ข้อมูลขาดการระบุชื่อองค์กรและที่มา" -> "ข้อมูลไม่บอกชื่อองค์กร"
   - "มิใช่ข้อเท็จจริงเชิงประจักษ์" -> "ไม่จริง"
4. ฟันธงสั้นๆ และบอกความจริงที่ถูกต้องพร้อมแหล่งอ้างอิง

ตัวอย่างประโยคมาตรฐาน:
- กรณีเป็น "เท็จ" (FALSE):
  "ภาพนี้ไม่ใช่ที่เชียงใหม่ แต่เป็นการประท้วงที่กรุงเทพฯ ปี 63 (อ้างอิง: ...)"
  "คนพูดไม่ได้พูดประโยคนี้ ข้อความจริงคือ..."
- กรณี "บิดเบือน" (MISLEADING):
  "คลิปนี้ถูกตัดตอน จริงๆ พูดถึงนโยบายเศรษฐกิจ ไม่ใช่ทหาร"
  "ตัวเลขนี้จริง แต่เป็นข้อมูลเก่าปี 60 ไม่ใช่ปัจจุบัน"

หน้าที่ของคุณ:
1. หากเนื้อหาคลิปถูกต้อง ไม่มีประเด็นต้องแก้ไข ให้ตอบคำเดียวว่า "SKIP" (ห้ามมีคำอื่น)
2. หากไม่มี claim ที่ตรวจสอบได้ เช่น ประโยคไม่สมบูรณ์/พูดค้างไว้, คำทักทาย, มุกตลก, หรือความคิดเห็นล้วนๆ ให้ตอบคำเดียวว่า "SKIP" (ห้ามมีคำอื่น)
3. ห้ามเขียน ANALYSIS ทำนอง "คลิปสั้นเกินไป", "บริบทไม่เพียงพอ", "ไม่สามารถตรวจสอบได้", "ไม่ทราบที่มา" โดยเด็ดขาด — กรณีเหล่านั้นต้องตอบ "SKIP" เท่านั้น
4. หากเนื้อหาเข้าข่าย เท็จ (FALSE), บิดเบือน (MISLEADING), หรือข้อมูลที่เป็นความจริงที่สำคัญที่ต้องยืนยัน (FACT) ให้สรุปฟันธงทันที

คุณต้องแสดงผลลัพธ์ในรูปแบบ Tag ดังนี้เท่านั้น (ห้ามมี Markdown Code block หรือคำเกริ่นนำ):
[TOPIC: <หัวข้อสั้นๆ ไม่เกิน 5 คำ>]
[SPEAKER: <ชื่อคนพูด>]
[VERDICT: <FACT | FALSE | MISLEADING>]
[ANALYSIS: <เขียนฟันธง 2-4 ประโยคตามแนวทางด้านบน พร้อมข้อเท็จจริงที่ถูกต้องและแหล่งอ้างอิง>]

Context from database:
{CONTEXT}

ข้อมูลพื้นหลังของช่องนี้ (หัวข้อ/บุคคลที่เคยพูดถึงบ่อยในอดีต ใช้ทำความเข้าใจพื้นหลังเท่านั้น ห้ามอ้างเป็นข้อเท็จจริงใหม่หรือใช้แทนข้อมูลปัจจุบัน ระวังอย่านำตำแหน่ง/สถานะเก่ามาตัดสินคำพูดที่กำลังพูดถึงช่วงเวลาอื่น):
{CHANNEL_HISTORY}

บทสนทนาช่วงก่อนหน้า (ใช้ทำความเข้าใจบริบทเท่านั้น ห้ามตรวจสอบซ้ำ ห้ามอ้างเป็นคำพูดใหม่):
{CONTEXT_BEFORE}

Transcript to analyze:
{TRANSCRIPT}
`;

/**
 * Fact check using Gemini Stream
 * Streams the response to Redis pub/sub channel for real-time broadcast
 */
export const streamFactCheck = async (videoId, transcriptChunk, ragContext = '', contextBefore = '', needsGrounding = true, chunkStartTime = 0) => {
  const channelName = `factcheck:${videoId}`;

  // Skip if already processing another chunk for this video (prevent rate limit avalanche)
  if (processingVideos.has(videoId)) {
    console.log(`[LLM] Skipping chunk for ${videoId} - already processing another request for this video`);
    return null;
  }
  
  if (!genAI) {
    // Mock streaming
    console.log(`[LLM Mock] Fact checking for ${videoId}`);
    const mockText = "This is a mock fact-check result streamed word by word.";
    const words = mockText.split(' ');
    
    let fullText = "";
    for (const word of words) {
      fullText += word + " ";
      await publish(channelName, { type: 'chunk', text: fullText });
      await new Promise(r => setTimeout(r, 100)); // Delay
    }
    await publish(channelName, { type: 'done', text: fullText.trim() });
    return fullText.trim();
  }

  processingVideos.add(videoId);
  console.log(`[LLM] Starting fact-check for ${videoId}...`);

  try {
    const model = genAI.getGenerativeModel({
      model: config.gemini.model,
      // thinkingBudget: 0 - gemini-3.5-flash คิดภายใน (thinking) โดยปริยาย กินไป ~300-500/512 token
      // ทำให้คำตอบจริงถูกตัดกลางคัน (finishReason: MAX_TOKENS) - ปิดไว้เพื่อความสมบูรณ์ของคำตอบ + ประหยัด token ~3 เท่า
      generationConfig: { temperature: 0.2, topP: 0.9, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
      // เปิด Google Search grounding เฉพาะเมื่อ RAG อ่อน (needsGrounding) และไม่ได้ปิดผ่าน env
      ...(config.gemini.groundingEnabled && needsGrounding ? { tools: [{ google_search: {} }] } : {}),
    });

    const channelHistory = getChannelHistoryContext(videoId);
    const prompt = getFactCheckPrompt()
      .replace('{CONTEXT}', ragContext || 'No context found.')
      .replace('{CHANNEL_HISTORY}', channelHistory || 'ไม่มีข้อมูลประวัติช่องนี้มาก่อน')
      .replace('{CONTEXT_BEFORE}', contextBefore || 'ไม่มี (จุดเริ่มต้นคลิป)')
      .replace('{TRANSCRIPT}', transcriptChunk);

    const result = await model.generateContentStream(prompt);
    
    let fullText = "";
    let shouldStream = null; // null = undecided, true = stream, false = discard/skip
    const factCheckId = `fc_${videoId}_${Date.now()}`;
    
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullText += chunkText;
      
      // Determine if we should stream this response to the client
      if (shouldStream === null) {
        // If the model output indicates an early skip
        if (fullText.includes("SKIP") || fullText.toLowerCase().includes("no_fact_check_needed")) {
          shouldStream = false;
          console.log(`[LLM] Skipped early: filler or accurate content`);
        } 
        // Once we hit the VERDICT tag, we can decide based on the value
        else if (fullText.includes("[VERDICT:")) {
          const verdictMatch = fullText.match(/\[VERDICT:\s*([^\]]*?)\]/i);
          if (verdictMatch) {
            const verdict = verdictMatch[1].trim().toUpperCase();
            if (verdict === 'FACT' || verdict === 'FALSE' || verdict === 'MISLEADING') {
              shouldStream = true;
              console.log(`[LLM] Verdict is ${verdict} - starting stream for ${videoId}`);
              // Send the initial buffered text up to this point
              await publish(channelName, { 
                type: 'chunk', 
                text: fullText,
                factCheckId: factCheckId
              });
            } else {
              shouldStream = false;
              console.log(`[LLM] Verdict is ${verdict} - skipping stream for ${videoId}`);
            }
          }
        }
      } else if (shouldStream === true) {
        // Broadcast the accumulated text to the client
        await publish(channelName, { 
          type: 'chunk', 
          text: fullText,
          factCheckId: factCheckId
        });
      }
    }
    
    console.log(`[LLM] Completed processing for ${videoId}. shouldStream: ${shouldStream}`);
    
    if (shouldStream === true) {
      // Broadcast completion
      await publish(channelName, { 
        type: 'done', 
        text: fullText.trim(),
        factCheckId: factCheckId
      });

      // Save to history log for prompt adjustments
      logFactCheckToHistory(videoId, transcriptChunk, ragContext, fullText);

      // จำผลไว้ถาวร (ข้าม session/server restart) กันรัน AI ซ้ำถ้าช่วงนี้ของวิดีโอถูกดูอีก
      setCachedResult(videoId, chunkStartTime, fullText.trim());

      return fullText.trim();
    } else {
      await publish(channelName, { type: 'cancel' });
      if (shouldStream === false) {
        // AI ตัดสินใจ SKIP ชัดเจนแล้ว (ไม่ใช่ error/ติด lock) - จำไว้กันรันซ้ำเช่นกัน
        setCachedResult(videoId, chunkStartTime, 'SKIP');
      }
      return null;
    }

  } catch (error) {
    console.error(`[LLM] Error:`, error.message || error);
    
    const errorMsg = error.status === 429
      ? 'API quota exceeded. Please wait or check billing.'
      : 'Fact check failed: ' + (error.message || 'Unknown error');
    
    await publish(channelName, { type: 'error', message: errorMsg });
    return null;
  } finally {
    processingVideos.delete(videoId);
  }
};

export const testPromptFactCheck = async (promptText, transcriptText, contextText, contextBeforeText = '', channelHistoryText = '') => {
  if (!genAI) {
    console.log('[LLM Test Mock] Testing testPromptFactCheck offline mode');
    return "[TOPIC: ทดสอบระบบ]\n[SPEAKER: แอดมิน]\n[VERDICT: FACT]\n[ANALYSIS: นี่คือการประมวลผลจำลองบนเซิร์ฟเวอร์แบบออฟไลน์]";
  }

  try {
    const model = genAI.getGenerativeModel({
      model: config.gemini.model,
      generationConfig: { temperature: 0.2, topP: 0.9, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
      ...(config.gemini.groundingEnabled ? { tools: [{ google_search: {} }] } : {}),
    });
    const formattedPrompt = promptText
      .replace('{CONTEXT}', contextText || 'No context found.')
      .replace('{CHANNEL_HISTORY}', channelHistoryText || 'ไม่มีข้อมูลประวัติช่องนี้มาก่อน')
      .replace('{CONTEXT_BEFORE}', contextBeforeText || 'ไม่มี (จุดเริ่มต้นคลิป)')
      .replace('{TRANSCRIPT}', transcriptText);

    const result = await model.generateContent(formattedPrompt);
    return result.response.text();
  } catch (error) {
    console.error('[LLM Test] Failed to run test prompt:', error);
    throw new Error('Test run failed: ' + error.message);
  }
};
