import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  {
    videoId: 'clip-b',
    domain: 'known_gap',
    expectedBehavior: 'known_failure',
    knownFailureReason: 'probe not wired yet',
  },
];

const actuals = {
  'clip-a': {
    status: 'cards',
    cards: [{ topicTitle: 'งบประมาณโครงการ', claim: 'งบประมาณโครงการเพิ่มขึ้น' }],
    metrics: {},
  },
};

test('CLI reads fixture and actual JSON files and prints JSON benchmark output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vod-benchmark-cli-'));
  const fixtureFile = writeJson(dir, 'fixtures.json', fixtures);
  const actualFile = writeJson(dir, 'actuals.json', actuals);

  const result = spawnSync(process.execPath, [scriptPath, '--fixture', fixtureFile, '--actual', actualFile, '--json'], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.total, 2);
  assert.equal(parsed.summary.passed, 1);
  assert.equal(parsed.summary.known_failure, 1);
  assert.equal(parsed.summary.technical_failure, 0);
});

test('CLI can filter one video and write markdown report to --out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vod-benchmark-cli-'));
  const fixtureFile = writeJson(dir, 'fixtures.json', fixtures);
  const actualFile = writeJson(dir, 'actuals.json', actuals);
  const outFile = join(dir, 'report.md');

  const result = spawnSync(process.execPath, [
    scriptPath,
    '--fixture', fixtureFile,
    '--actual', actualFile,
    '--case', 'clip-a',
    '--out', outFile,
  ], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Wrote VOD benchmark report/);
  const report = readFileSync(outFile, 'utf8');
  assert.match(report, /# VOD Benchmark Report/);
  assert.match(report, /\| total \| 1 \|/);
  assert.match(report, /\| clip-a \| policy_budget \| passed \|/);
});

test('CLI maps missing actual results to technical_failure instead of silently passing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vod-benchmark-cli-'));
  const fixtureFile = writeJson(dir, 'fixtures.json', fixtures.slice(0, 1));

  const result = spawnSync(process.execPath, [scriptPath, '--fixture', fixtureFile, '--json'], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.technical_failure, 1);
  assert.equal(parsed.results[0].reason, 'actual_result_missing');
});

test('probe runner initializes Gemini client before creating the actual runner', async () => {
  const { createProbeRunner } = await import(`${pathToFileURL(scriptPath).href}?probe-init-test=${Date.now()}`);
  let initialized = false;
  let createdAfterInit = false;

  const runner = await createProbeRunner({
    initLLM: () => {
      initialized = true;
    },
    createVodBenchmarkActualRunner: () => {
      createdAfterInit = initialized;
      return async () => ({ status: 'no_card', cards: [], metrics: {} });
    },
  });

  assert.equal(initialized, true);
  assert.equal(createdAfterInit, true);
  assert.equal(typeof runner, 'function');
});
