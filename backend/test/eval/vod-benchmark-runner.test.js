import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatVodBenchmarkReport,
  runVodBenchmarkCases,
} from '../../src/eval/vod-benchmark-runner.js';

const fixtures = [
  {
    videoId: 'no-card-video',
    domain: 'short_no_claim',
    expectedBehavior: 'no_card',
    expectedNoCardReason: 'low_claim_density',
    allowedMaxCards: 0,
    guardExpectations: {
      llmCallAvoided: true,
    },
  },
  {
    videoId: 'required-video',
    domain: 'policy_budget',
    expectedBehavior: 'cards_required',
    minCards: 1,
    maxCards: 2,
    minExpectedThemeMatches: 1,
    expectedTopThemes: ['งบประมาณ'],
  },
  {
    videoId: 'known-failure-video',
    domain: 'known_gap',
    expectedBehavior: 'known_failure',
    knownFailureReason: 'live probe not implemented yet',
  },
];

test('runs fixtures through an injected pure case runner and summarizes evaluated outcomes', async () => {
  const seen = [];
  const benchmark = await runVodBenchmarkCases(fixtures, {
    now: () => 1000,
    runCase: async (fixture) => {
      seen.push(fixture.videoId);
      if (fixture.videoId === 'no-card-video') {
        return {
          status: 'no_card',
          noCardReason: 'low_claim_density',
          cards: [],
          metrics: { llmCallAvoided: true },
        };
      }
      if (fixture.videoId === 'required-video') {
        return {
          status: 'cards',
          cards: [{ topicTitle: 'งบประมาณโครงการ', claim: 'งบประมาณโครงการเพิ่มขึ้น' }],
          metrics: {},
        };
      }
      return { status: 'no_claims', cards: [], metrics: {} };
    },
  });

  assert.deepEqual(seen, ['no-card-video', 'required-video', 'known-failure-video']);
  assert.deepEqual(benchmark.summary, {
    total: 3,
    passed: 2,
    failed: 0,
    known_failure: 1,
    not_implemented: 0,
    technical_failure: 0,
  });
  assert.equal(benchmark.results[0].status, 'passed');
  assert.equal(benchmark.results[1].status, 'passed');
  assert.equal(benchmark.results[2].status, 'known_failure');
  assert.equal(benchmark.durationMs, 0);
});

test('maps thrown case-runner errors to technical_failure without aborting the benchmark', async () => {
  const benchmark = await runVodBenchmarkCases([fixtures[1]], {
    now: () => 2000,
    runCase: async () => {
      throw new Error('Gemini 503 high demand');
    },
  });

  assert.deepEqual(benchmark.summary, {
    total: 1,
    passed: 0,
    failed: 0,
    known_failure: 0,
    not_implemented: 0,
    technical_failure: 1,
  });
  assert.equal(benchmark.results[0].status, 'technical_failure');
  assert.equal(benchmark.results[0].reason, 'case_runner_error');
  assert.match(benchmark.results[0].errorMessage, /Gemini 503/);
});

test('filters fixtures by videoId when a case filter is provided', async () => {
  const benchmark = await runVodBenchmarkCases(fixtures, {
    filter: { videoId: 'required-video' },
    runCase: async () => ({
      status: 'cards',
      cards: [{ topicTitle: 'งบประมาณโครงการ', claim: 'งบประมาณโครงการเพิ่มขึ้น' }],
      metrics: {},
    }),
  });

  assert.equal(benchmark.results.length, 1);
  assert.equal(benchmark.results[0].videoId, 'required-video');
  assert.equal(benchmark.summary.total, 1);
});

test('formats a stable markdown report for CLI and file output', async () => {
  const benchmark = await runVodBenchmarkCases([fixtures[0]], {
    runCase: async () => ({
      status: 'no_card',
      noCardReason: 'low_claim_density',
      cards: [],
      metrics: { llmCallAvoided: true },
    }),
  });

  const report = formatVodBenchmarkReport(benchmark);

  assert.match(report, /# VOD Benchmark Report/);
  assert.match(report, /\| total \| 1 \|/);
  assert.match(report, /\| no-card-video \| short_no_claim \| passed \|/);
});
