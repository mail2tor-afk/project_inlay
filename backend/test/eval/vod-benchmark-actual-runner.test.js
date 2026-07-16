import assert from 'node:assert/strict';
import test from 'node:test';

import { createVodBenchmarkActualRunner } from '../../src/eval/vod-benchmark-actual-runner.js';

const sufficientTranscript = [
  { text: 'รัฐมนตรีกล่าวว่าโครงการนี้ใช้งบประมาณ 500 ล้านบาท', offset: 0, duration: 5000 },
  { text: 'เอกสารระบุว่าจ่ายตามจำนวนผู้ใช้งานจริง', offset: 5000, duration: 5000 },
  { text: 'ระบบนี้มีวัตถุประสงค์หลักเป็นแพลตฟอร์ม e-learning', offset: 10000, duration: 5000 },
];

test('actual runner maps low-claim-density transcript to no_card without calling extractor', async () => {
  let extractorCalled = false;
  const runCase = createVodBenchmarkActualRunner({
    ensureTranscript: async () => [{ text: 'ฮ่า ฮ่า เพลง เพลง คุยเล่นเฉยๆ', offset: 0, duration: 1000 }],
    extractVodTopicsWithDiagnostics: async () => {
      extractorCalled = true;
      return { ok: true, topics: [] };
    },
    getVideoMetadata: () => ({ title: 'short clip' }),
  });

  const actual = await runCase({ videoId: 'short-video' });

  assert.equal(actual.status, 'no_card');
  assert.equal(actual.noCardReason, 'low_claim_density');
  assert.equal(actual.cards.length, 0);
  assert.equal(actual.metrics.llmCallAvoided, true);
  assert.equal(extractorCalled, false);
});

test('actual runner returns selected transcript-grounded cards from extractor diagnostics', async () => {
  const runCase = createVodBenchmarkActualRunner({
    ensureTranscript: async () => sufficientTranscript,
    getVideoMetadata: () => ({ title: 'AI Passport งบประมาณ' }),
    extractVodTopicsWithDiagnostics: async (fullText, videoId, transcriptSegments, videoMeta) => {
      assert.match(fullText, /งบประมาณ 500 ล้านบาท/);
      assert.equal(videoId, 'policy-video');
      assert.equal(transcriptSegments.length, 3);
      assert.equal(videoMeta.title, 'AI Passport งบประมาณ');
      return {
        ok: true,
        usedModel: 'fake-extractor',
        topics: [
          {
            topicTitle: 'งบประมาณโครงการ AI Passport',
            claim: 'โครงการนี้ใช้งบประมาณ 500 ล้านบาท',
            normalizedClaim: 'โครงการนี้ใช้งบประมาณ 500 ล้านบาท',
            exactQuote: 'รัฐมนตรีกล่าวว่าโครงการนี้ใช้งบประมาณ 500 ล้านบาท',
            mainTopicRole: 'central_claim',
            videoTopicRelevanceScore: 10,
            publicInterestScore: 9,
            factCheckabilityScore: 10,
            evidenceAvailabilityScore: 8,
            quoteFidelityScore: 10,
            ambiguityPenalty: 0,
            evidencePath: { primarySearchQuery: 'AI Passport งบประมาณ 500 ล้านบาท' },
          },
          {
            topicTitle: 'มุกตลกนอกประเด็น',
            claim: 'คิดว่าอันนี้ตลกดี',
            normalizedClaim: 'คิดว่าอันนี้ตลกดี',
            exactQuote: 'คิดว่าอันนี้ตลกดี',
            mainTopicRole: 'tangent',
            factCheckabilityScore: 0,
            quoteFidelityScore: 10,
          },
        ],
      };
    },
  });

  const actual = await runCase({ videoId: 'policy-video' });

  assert.equal(actual.status, 'cards');
  assert.equal(actual.cards.length, 1);
  assert.equal(actual.cards[0].topicTitle, 'งบประมาณโครงการ AI Passport');
  assert.equal(actual.metrics.rawTopics, 2);
  assert.equal(actual.metrics.selectedTopics, 1);
  assert.equal(actual.metrics.usedModel, 'fake-extractor');
});

test('actual runner preserves extractor outages as technical_failure', async () => {
  const runCase = createVodBenchmarkActualRunner({
    ensureTranscript: async () => sufficientTranscript,
    getVideoMetadata: () => ({}),
    extractVodTopicsWithDiagnostics: async () => ({
      ok: false,
      topics: [],
      errorType: 'provider_unavailable',
      errorMessage: 'Gemini 503 high demand',
      attempts: [{ model: 'gemini-3-flash-preview', ok: false, errorType: 'provider_unavailable' }],
    }),
  });

  const actual = await runCase({ videoId: 'provider-down-video' });

  assert.equal(actual.status, 'technical_failure');
  assert.equal(actual.failureReason, 'provider_unavailable');
  assert.match(actual.errorMessage, /Gemini 503/);
  assert.equal(actual.metrics.rawTopics, 0);
  assert.equal(actual.metrics.selectedTopics, 0);
});
