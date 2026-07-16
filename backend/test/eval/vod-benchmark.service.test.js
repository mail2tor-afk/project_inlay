import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  evaluateVodBenchmarkCase,
  summarizeVodBenchmarkResults,
  validateVodBenchmarkCase,
} from '../../src/eval/vod-benchmark.service.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/vod-benchmark-cases.json', import.meta.url), 'utf8'));

test('validates Phase 1.6 fixtures that support no-card, cards-required, and known-failure cases', () => {
  assert.ok(fixtures.length >= 4);
  for (const fixture of fixtures) {
    assert.deepEqual(validateVodBenchmarkCase(fixture), { valid: true, errors: [] });
  }
});

test('passes a no-card fixture only when no cards are emitted for the expected guard reason', () => {
  const result = evaluateVodBenchmarkCase(fixtures[0], {
    status: 'no_card',
    noCardReason: 'low_claim_density',
    cards: [],
    metrics: {
      llmCallAvoided: true,
      acceptedQuoteDrift: 0,
      acceptedHallucinatedNumbers: 0,
    },
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.failures, []);
});

test('fails a no-card fixture when hallucinated or must-not-select cards are accepted', () => {
  const result = evaluateVodBenchmarkCase(fixtures[0], {
    status: 'cards',
    noCardReason: null,
    cards: [
      {
        topicTitle: 'วิดีโอแรกบน YouTube',
        claim: 'วิดีโอนี้เป็นวิดีโอแรกบน YouTube และถ่ายที่ San Diego Zoo',
        quoteDrift: { isDrifted: true },
      },
    ],
    metrics: {
      llmCallAvoided: false,
      acceptedQuoteDrift: 1,
      acceptedHallucinatedNumbers: 1,
    },
  });

  assert.equal(result.status, 'failed');
  assert.match(result.failures.join('\n'), /expected no_card/);
  assert.match(result.failures.join('\n'), /mustNotSelect/);
  assert.match(result.failures.join('\n'), /acceptedQuoteDrift/);
  assert.match(result.failures.join('\n'), /acceptedHallucinatedNumbers/);
});

test('passes a cards-required fixture when enough cards match expected themes and guard metrics stay clean', () => {
  const result = evaluateVodBenchmarkCase(fixtures[1], {
    status: 'cards',
    cards: [
      { topicTitle: 'วัตถุประสงค์หลักใน TOR ของ AI Passport', claim: 'AI Passport เป็นแพลตฟอร์ม e-learning', mainTopicRole: 'central_claim', videoTopicRelevanceScore: 10, quoteFidelityScore: 10, evidencePath: {} },
      { topicTitle: 'การปรับเปลี่ยนงบประมาณ AI Passport เป็น Pay per Active User', claim: 'จ่ายตามจำนวนผู้ใช้งานจริง', mainTopicRole: 'central_claim', videoTopicRelevanceScore: 10, quoteFidelityScore: 10, evidencePath: {} },
      { topicTitle: 'งบประมาณการพัฒนาระบบซอฟต์แวร์', claim: 'งบพัฒนาระบบประมาณ 79 ล้านบาท', mainTopicRole: 'supporting_claim', videoTopicRelevanceScore: 9, quoteFidelityScore: 10, evidencePath: {} },
    ],
    metrics: {
      acceptedQuoteDrift: 0,
      missingMetadata: 0,
      lowQuoteSelected: 0,
    },
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.failures, []);
});

test('fails a cards-required fixture when only one expected theme matches repeatedly', () => {
  const result = evaluateVodBenchmarkCase(fixtures[1], {
    status: 'cards',
    cards: [
      { topicTitle: 'AI Passport เรื่องทั่วไป', claim: 'AI Passport เป็นแพลตฟอร์ม' },
      { topicTitle: 'AI Passport อีกประเด็น', claim: 'AI Passport เกี่ยวกับ e-learning' },
    ],
    metrics: {
      acceptedQuoteDrift: 0,
      missingMetadata: 0,
      lowQuoteSelected: 0,
    },
  });

  assert.equal(result.status, 'failed');
  assert.match(result.failures.join('\n'), /expectedTopThemes/);
});

test('fails title-mismatch fixture when title-only claims are accepted', () => {
  const result = evaluateVodBenchmarkCase(fixtures[2], {
    status: 'cards',
    cards: [
      { topicTitle: 'ไฟไหม้โรงเบียร์', claim: 'เกิดไฟไหม้โรงเบียร์ดังกลางกรุง' },
    ],
    metrics: {
      titleTranscriptAligned: false,
      titleMismatchHandled: false,
    },
  });

  assert.equal(result.status, 'failed');
  assert.match(result.failures.join('\n'), /mustNotSelect/);
  assert.match(result.failures.join('\n'), /titleMismatchHandled/);
});

test('passes title-mismatch fixture when mismatch is handled and selected cards anchor to transcript', () => {
  const result = evaluateVodBenchmarkCase(fixtures[2], {
    status: 'cards',
    cards: [
      { topicTitle: 'สัดส่วนเกษตรกรที่เข้าถึงระบบชลประทาน', claim: 'เกษตรกรเข้าถึงชลประทานบางส่วน' },
    ],
    metrics: {
      titleTranscriptAligned: false,
      titleMismatchHandled: true,
    },
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.failures, []);
});

test('fails a cards-allowed fixture when emitted cards do not match any expected transcript theme', () => {
  const result = evaluateVodBenchmarkCase(fixtures[2], {
    status: 'cards',
    cards: [
      { topicTitle: 'ประเด็นไม่เกี่ยวข้อง', claim: 'การจราจรในกรุงเทพและราคาน้ำมันวันนี้' },
    ],
    metrics: {
      titleTranscriptAligned: false,
      titleMismatchHandled: true,
    },
  });

  assert.equal(result.status, 'failed');
  assert.match(result.failures.join('\n'), /expectedTopThemes/);
});

test('passes a cards-allowed fixture with no emitted cards because cards are optional', () => {
  const result = evaluateVodBenchmarkCase(fixtures[2], {
    status: 'no_claims',
    cards: [],
    metrics: {
      titleTranscriptAligned: false,
      titleMismatchHandled: true,
    },
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.failures, []);
});

test('marks extractor/provider failure as technical_failure instead of no-card or ordinary failed benchmark', () => {
  const result = evaluateVodBenchmarkCase(fixtures[1], {
    status: 'technical_failure',
    failureReason: 'extractor_provider_unavailable',
    cards: [],
    metrics: {
      llmCallAvoided: false,
      rawTopics: 0,
      selectedTopics: 0,
    },
  });

  assert.equal(result.status, 'technical_failure');
  assert.match(result.reason, /extractor_provider_unavailable/);
  assert.deepEqual(result.failures, []);
});

test('summarizes benchmark outcomes for reporting', () => {
  const summary = summarizeVodBenchmarkResults([
    { status: 'passed' },
    { status: 'failed' },
    { status: 'known_failure' },
    { status: 'not_implemented' },
    { status: 'technical_failure' },
  ]);

  assert.deepEqual(summary, {
    total: 5,
    passed: 1,
    failed: 1,
    known_failure: 1,
    not_implemented: 1,
    technical_failure: 1,
  });
});
