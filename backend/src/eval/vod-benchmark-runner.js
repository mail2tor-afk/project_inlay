import {
  evaluateVodBenchmarkCase,
  summarizeVodBenchmarkResults,
} from './vod-benchmark.service.js';

const asArray = (value) => Array.isArray(value) ? value : [];

const fixtureMatchesFilter = (fixture, filter = {}) => {
  if (!filter || Object.keys(filter).length === 0) return true;
  if (filter.videoId && fixture.videoId !== filter.videoId) return false;
  if (filter.domain && fixture.domain !== filter.domain) return false;
  if (filter.expectedBehavior && fixture.expectedBehavior !== filter.expectedBehavior) return false;
  return true;
};

const safeErrorMessage = (error) => {
  if (!error) return 'unknown error';
  if (error instanceof Error) return error.message || error.name || 'unknown error';
  return String(error);
};

const technicalFailureActual = (error) => ({
  status: 'technical_failure',
  failureReason: 'case_runner_error',
  cards: [],
  metrics: {},
  errorMessage: safeErrorMessage(error),
});

export const runVodBenchmarkCases = async (fixtures = [], options = {}) => {
  const runCase = typeof options.runCase === 'function'
    ? options.runCase
    : async () => ({ status: 'technical_failure', failureReason: 'case_runner_not_configured', cards: [], metrics: {} });
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const startedAtMs = now();
  const selectedFixtures = asArray(fixtures).filter(fixture => fixtureMatchesFilter(fixture, options.filter));
  const results = [];

  for (const fixture of selectedFixtures) {
    let actual;
    try {
      actual = await runCase(fixture);
    } catch (error) {
      actual = technicalFailureActual(error);
    }

    const evaluated = evaluateVodBenchmarkCase(fixture, actual);
    if (actual?.errorMessage && !evaluated.errorMessage) evaluated.errorMessage = actual.errorMessage;
    if (actual?.status === 'technical_failure' && actual?.failureReason && !evaluated.reason) {
      evaluated.reason = actual.failureReason;
    }
    results.push(evaluated);
  }

  const endedAtMs = now();
  return {
    summary: summarizeVodBenchmarkResults(results),
    results,
    durationMs: Math.max(0, endedAtMs - startedAtMs),
  };
};

export const formatVodBenchmarkReport = (benchmark = {}) => {
  const summary = benchmark.summary || summarizeVodBenchmarkResults(benchmark.results || []);
  const results = asArray(benchmark.results);
  const lines = [
    '# VOD Benchmark Report',
    '',
    '## Summary',
    '',
    '| Metric | Count |',
    '|---|---:|',
  ];

  for (const key of ['total', 'passed', 'failed', 'known_failure', 'not_implemented', 'technical_failure']) {
    lines.push(`| ${key} | ${summary[key] ?? 0} |`);
  }

  lines.push('', '## Results', '', '| Video ID | Domain | Status | Details |', '|---|---|---|---|');

  for (const result of results) {
    const details = [
      ...(asArray(result.failures)),
      result.reason ? `reason: ${result.reason}` : '',
      result.errorMessage ? `error: ${result.errorMessage}` : '',
    ].filter(Boolean).join('; ');
    lines.push(`| ${result.videoId || ''} | ${result.domain || ''} | ${result.status || 'unknown'} | ${details || '-'} |`);
  }

  if (Number.isFinite(benchmark.durationMs)) {
    lines.push('', `Duration: ${benchmark.durationMs}ms`);
  }

  return `${lines.join('\n')}\n`;
};
