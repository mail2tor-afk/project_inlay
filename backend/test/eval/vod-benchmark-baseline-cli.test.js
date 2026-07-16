import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptPath = fileURLToPath(new URL('../../scripts/run-vod-benchmark.js', import.meta.url));

const writeJson = (dir, name, value) => {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  return file;
};

const fixtures = [
  {
    videoId: 'clip-a',
    domain: 'policy_budget',
    expectedBehavior: 'cards_required',
    minCards: 1,
    maxCards: 2,
    minExpectedThemeMatches: 1,
    expectedTopThemes: ['งบประมาณ'],
  },
];

const passingActuals = {
  'clip-a': {
    status: 'cards',
    cards: [{ topicTitle: 'งบประมาณโครงการ', claim: 'งบประมาณโครงการเพิ่มขึ้น' }],
    metrics: {},
  },
};

test('CLI writes paired JSON and Markdown artifacts to --report-dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vod-benchmark-artifact-'));
  const fixtureFile = writeJson(dir, 'fixtures.json', fixtures);
  const actualFile = writeJson(dir, 'actuals.json', passingActuals);
  const reportDir = join(dir, 'reports');

  const result = spawnSync(process.execPath, [
    scriptPath,
    '--fixture', fixtureFile,
    '--actual', actualFile,
    '--report-dir', reportDir,
  ], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const jsonPath = join(reportDir, 'vod-benchmark.json');
  const markdownPath = join(reportDir, 'vod-benchmark.md');
  assert.equal(existsSync(jsonPath), true);
  assert.equal(existsSync(markdownPath), true);
  assert.equal(JSON.parse(readFileSync(jsonPath, 'utf8')).summary.passed, 1);
  assert.match(readFileSync(markdownPath, 'utf8'), /# VOD Benchmark Report/);
});

test('CLI compares current results with a baseline and reports no regressions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vod-benchmark-baseline-'));
  const fixtureFile = writeJson(dir, 'fixtures.json', fixtures);
  const actualFile = writeJson(dir, 'actuals.json', passingActuals);
  const baselineFile = writeJson(dir, 'baseline.json', {
    summary: { total: 1, passed: 1, failed: 0, known_failure: 0, not_implemented: 0, technical_failure: 0 },
    results: [{ videoId: 'clip-a', domain: 'policy_budget', status: 'passed', failures: [] }],
  });

  const result = spawnSync(process.execPath, [
    scriptPath,
    '--fixture', fixtureFile,
    '--actual', actualFile,
    '--baseline', baselineFile,
    '--json',
  ], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.comparison.regressions.length, 0);
  assert.equal(parsed.comparison.baselinePath.endsWith('baseline.json'), true);
});

test('CLI exits non-zero when --fail-on-regression detects a passed baseline becoming technical_failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vod-benchmark-regression-'));
  const fixtureFile = writeJson(dir, 'fixtures.json', fixtures);
  const baselineFile = writeJson(dir, 'baseline.json', {
    summary: { total: 1, passed: 1, failed: 0, known_failure: 0, not_implemented: 0, technical_failure: 0 },
    results: [{ videoId: 'clip-a', domain: 'policy_budget', status: 'passed', failures: [] }],
  });

  const result = spawnSync(process.execPath, [
    scriptPath,
    '--fixture', fixtureFile,
    '--baseline', baselineFile,
    '--fail-on-regression',
    '--json',
  ], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.comparison.regressions.length, 1);
  assert.equal(parsed.comparison.regressions[0].previousStatus, 'passed');
  assert.equal(parsed.comparison.regressions[0].currentStatus, 'technical_failure');
});
