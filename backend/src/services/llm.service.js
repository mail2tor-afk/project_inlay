import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';
import { publish } from './redis.service.js';

let genAI = null;

// Queue lock: only one LLM call at a time to prevent rate limit avalanche
let isProcessing = false;

export const initLLM = () => {
  if (config.gemini.apiKey) {
    genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    console.log('[LLM] Gemini API initialized');
  } else {
    console.warn('[LLM] Gemini API Key missing. Operating in mock mode.');
  }
};

const FACT_CHECK_PROMPT = `
คุณคือผู้เชี่ยวชาญการตรวจสอบข้อเท็จจริง (Fact-checker) ประจำวิดีโออย่างเข้มงวด

หลักการเขียน Fact-check (ปฏิบัติตามอย่างเคร่งครัด):
1. ตัดความคิดเห็นส่วนตัวออกทั้งหมด (Objectivity & Nonpartisanship): การเขียนต้องไม่มีอารมณ์ ความรู้สึก หรือการตัดสินคุณค่าใดๆ เจือปน ต้องนำเสนอเฉพาะสิ่งที่หลักฐานเชิงประจักษ์ระบุไว้เท่านั้น
2. เน้นความชัดเจนและกระชับ (Clarity & Succinctness): ควรอธิบายด้วยประโยคสั้นๆ ตรงไปตรงมา ไม่อ้อมค้อม หากต้องใช้คำศัพท์เฉพาะทาง ควรมีคำอธิบายสั้นๆ ที่เข้าใจง่าย
3. ให้บริบทที่ตรงจุด (Provide Exact Context): หากข้อมูลคลุมเครือหรือบิดเบือน การเขียนแก้ต้องระบุให้ชัดเจนว่า ขาดอะไรไป เช่น ใครทำอะไร ที่ไหน เมื่อไหร่ เพื่อป้องกันการเข้าใจผิดจากการนำเหตุการณ์เก่ามาเล่าซ้ำหรือตัดต่อภาพ
4. ระบุแหล่งอ้างอิงเสมอ (Transparency): ต้องโปร่งใสเรื่องแหล่งที่มาของข้อมูลที่ใช้แย้งเสมอ

ลักษณะประโยคที่มักใช้ในงาน Fact-check:
ประโยคที่ดีจะขึ้นต้นด้วย "ข้อเท็จจริง" หรือ "ข้อสรุป" ทันที โดยไม่ต้องมีคำเกริ่นนำลักษณะ "ข้อมูลดังกล่าวขาดความชัดเจนเนื่องจาก..." 

ตัวอย่างประโยคมาตรฐาน:
- กรณีเป็น "เท็จ" (FALSE):
  "ภาพนี้ไม่ใช่เหตุการณ์ที่เชียงใหม่ แต่เป็นภาพเหตุการณ์ประท้วงที่กรุงเทพฯ เมื่อปี 2563 (อ้างอิง: ...)"
  "บุคคลในคลิปไม่ได้กล่าวประโยคดังกล่าว ข้อความต้นฉบับคือ..."
- กรณี "บิดเบือน" (MISLEADING):
  "ข้อความนี้ถูกตัดตอน บริบทฉบับเต็มคือการพูดถึงนโยบายเศรษฐกิจ ไม่ใช่การสั่งการทางการทหาร"
  "ตัวเลขสถิตินี้เป็นความจริง แต่เป็นข้อมูลของปี 2560 ไม่ใช่ข้อมูลปัจจุบัน"

หน้าที่ของคุณ:
1. ตรวจสอบคลิปนี้ หากข้อมูลถูกต้องทั้งหมด ไม่มีข้อมูลที่เข้าข่าย "เท็จ" หรือ "บิดเบือน" หรือข้อมูลที่สลักสำคัญใดๆ ที่ต้องทำการแก้ไข ให้ตอบเพียงคำเดียวว่า "SKIP" เท่านั้น
2. หากมีข้อมูลที่เป็น เท็จ (FALSE), บิดเบือน (MISLEADING), หรือข้อมูลที่เป็นความจริงที่สลักสำคัญที่ต้องการยืนยันความถูกต้อง (FACT) ให้สรุปสั้นๆ ฟันธงตรงๆ ว่า จริง เท็จ หรือ บิดเบือน และบอกความจริงคืออะไร

คุณต้องแสดงผลลัพธ์ในรูปแบบ Tag ดังนี้เท่านั้น (ห้ามมี Markdown Code block หรือคำอื่นเกริ่นนำ):
[TOPIC: <หัวข้อสั้นๆ ไม่เกิน 5 คำ>]
[SPEAKER: <ชื่อคนพูด>]
[VERDICT: <FACT | FALSE | MISLEADING>]
[ANALYSIS: <ฟันธงสั้นๆ และบอกความจริงกระชับ 2 ประโยคตามหลักเกณฑ์ด้านบน>]

Context from database:
{CONTEXT}

Transcript to analyze:
{TRANSCRIPT}
`;

/**
 * Fact check using Gemini Stream
 * Streams the response to Redis pub/sub channel for real-time broadcast
 */
export const streamFactCheck = async (videoId, transcriptChunk, ragContext = '') => {
  const channelName = `factcheck:${videoId}`;
  
  // Skip if already processing another chunk (prevent rate limit avalanche)
  if (isProcessing) {
    console.log(`[LLM] Skipping chunk - already processing another request`);
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

  isProcessing = true;
  console.log(`[LLM] Starting fact-check for ${videoId}...`);
  
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    
    const prompt = FACT_CHECK_PROMPT
      .replace('{CONTEXT}', ragContext || 'No context found.')
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
      return fullText.trim();
    } else {
      await publish(channelName, { type: 'cancel' });
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
    isProcessing = false;
  }
};
