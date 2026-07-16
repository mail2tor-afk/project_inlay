import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const auditReportsPath = path.resolve(__dirname, '../../factchecks_audit_reports.json');

// Initialize Gemini for auditing
let genAI = null;
if (config.gemini.apiKey) {
  genAI = new GoogleGenerativeAI(config.gemini.apiKey);
}

/**
 * Run AI Audit on the full video transcript and generated factchecks
 */
export const runPostVideoAudit = async (videoId, fullTranscript, factChecks) => {
  if (!genAI) {
    console.log('[Audit Mock] Gemini API Key missing, operating in mock audit mode');
    return null;
  }

  if (!fullTranscript || !factChecks || factChecks.length === 0) {
    console.log(`[Audit] Skipping audit for ${videoId} - insufficient data`);
    return null;
  }

  console.log(`[Audit] Initiating post-video audit for ${videoId}...`);

  const AUDIT_PROMPT = `
You are the Head Editor and Chief Auditor of a real-time AI fact-checking system.
Below is the full transcript of a video segment and a list of real-time fact-checks that were generated during the video.

Tasks:
1. Review the full transcript carefully to understand the complete context.
2. Review each of the generated real-time fact-checks:
   - Check if any verdict (FACT, FALSE, MISLEADING) was wrong or incorrect based on the FULL context of the transcript.
   - Check if the analysis of the fact-check was incorrect or misleading.
   - Check if the fact-check was a duplicate or redundant.
3. Identify any critical discrepancies (i.e. mistakes made by the real-time AI).

You must respond in the following JSON format ONLY. Do not include markdown code block characters like \`\`\`json. Your response must be valid JSON:
{
  "videoId": "${videoId}",
  "auditTimestamp": "${new Date().toISOString()}",
  "hasDiscrepancies": true,
  "discrepancies": [
    {
      "factCheckId": "<id of the erroneous fact-check>",
      "topic": "<topic of the fact-check>",
      "realtimeVerdict": "<verdict that was displayed>",
      "realtimeAnalysis": "<analysis that was displayed>",
      "auditedVerdict": "FACT | FALSE | MISLEADING",
      "auditedAnalysis": "<detailed explanation of why the real-time check was wrong or how it should be corrected, written in Thai language>"
    }
  ]
}

If everything was correct and there were no discrepancies, return:
{
  "videoId": "${videoId}",
  "auditTimestamp": "${new Date().toISOString()}",
  "hasDiscrepancies": false,
  "discrepancies": []
}

Full Video Transcript:
"""
${fullTranscript}
"""

Generated Real-Time Fact-Checks:
${JSON.stringify(factChecks, null, 2)}
`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent(AUDIT_PROMPT);
    const responseText = result.response.text().trim();
    
    // Clean up potential markdown formatting wrapping the JSON
    let cleanJson = responseText;
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.substring(7);
    }
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.substring(3);
    }
    if (cleanJson.endsWith('```')) {
      cleanJson = cleanJson.substring(0, cleanJson.length - 3);
    }
    cleanJson = cleanJson.trim();

    const auditReport = JSON.parse(cleanJson);
    console.log(`[Audit] Finished audit run for ${videoId}. hasDiscrepancies: ${auditReport.hasDiscrepancies}`);

    if (auditReport.hasDiscrepancies && auditReport.discrepancies.length > 0) {
      saveAuditReport(auditReport);
    }

    return auditReport;
  } catch (error) {
    console.error('[Audit] Failed to run AI audit:', error);
    return null;
  }
};

/**
 * Save audit report containing discrepancies to local JSON file
 */
const saveAuditReport = (report) => {
  try {
    let reports = [];
    if (fs.existsSync(auditReportsPath)) {
      const fileData = fs.readFileSync(auditReportsPath, 'utf8');
      if (fileData.trim()) {
        reports = JSON.parse(fileData);
      }
    }
    
    // Add unique ID for report
    const id = `audit_${report.videoId}_${Date.now()}`;
    reports.push({
      id,
      resolved: false,
      ...report
    });

    fs.writeFileSync(auditReportsPath, JSON.stringify(reports, null, 2), 'utf8');
    console.log(`[Audit] Saved discrepancies report to: ${auditReportsPath}`);
  } catch (error) {
    console.error('[Audit] Failed to save audit report:', error);
  }
};

/**
 * Fetch all saved audit reports
 */
export const getAuditReports = () => {
  try {
    if (fs.existsSync(auditReportsPath)) {
      const fileData = fs.readFileSync(auditReportsPath, 'utf8');
      if (fileData.trim()) {
        return JSON.parse(fileData);
      }
    }
  } catch (error) {
    console.error('[Audit] Failed to read audit reports:', error);
  }
  return [];
};

/**
 * Resolve/Dismiss an audit report
 */
export const resolveAuditReport = (reportId) => {
  try {
    if (fs.existsSync(auditReportsPath)) {
      const fileData = fs.readFileSync(auditReportsPath, 'utf8');
      if (fileData.trim()) {
        const reports = JSON.parse(fileData);
        const updated = reports.map(r => r.id === reportId ? { ...r, resolved: true } : r);
        fs.writeFileSync(auditReportsPath, JSON.stringify(updated, null, 2), 'utf8');
        console.log(`[Audit] Resolved report: ${reportId}`);
        return true;
      }
    }
  } catch (error) {
    console.error('[Audit] Failed to resolve audit report:', error);
  }
  return false;
};
