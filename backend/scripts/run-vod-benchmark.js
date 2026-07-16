#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatVodBenchmarkReport,
  runVodBenchmarkCases,
} from '../src/eval/vod-benchmark-runner.js';

const DEFAULT_FIXTURE = 'test/fixtures/vod-benchmark-cases.json';

const printUsage = () => {
  console.log(`Usage: node scripts/run-vod-benchmark.js [options]

Options:
  --fixture <path>             Fixture JSON file (default: ${DEFAULT_FIXTURE})
  --actual <path>              Actual result JSON file keyed by videoId or array of { videoId, actual }
  --probe                      Build actuals from transcript + VOD extractor instead of --actual JSON
  --case <videoId>             Run one fixture by videoId
  --domain <domain>            Run fixtures for one domain
  --expected-behavior <name>   Run fixtures by expectedBehavior
  --json                       Print JSON output instead of Markdown
  --out <path>                 Write output to file and print the path
  --report-dir <path>          Write vod-benchmark.json and vod-benchmark.md artifacts
  --baseline <path>            Compare current benchmark with a prior benchmark JSON
  --fail-on-regression         Exit 1 when comparison contains regressions
  --help                       Show this help
`);
};

const parseArgs = (argv) => {
  const args = {
    fixture: DEFAULT_FIXTURE,
    actual: null,
    probe: false,
    filter: {},
    json: false,
    out: null,
    reportDir: null,
    baseline: null,
    failOnRegression: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[i];
    };

    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--fixture') args.fixture = next();
    else if (arg === '--actual') args.actual = next();
    else if (arg === '--probe') args.probe = true;
    else if (arg === '--case') args.filter.videoId = next();
    else if (arg === '--domain') args.filter.domain = next();
    else if (arg === '--expected-behavior') args.filter.expectedBehavior = next();
    else if (arg === '--json') args.json = true;
    else if (arg === '--out') args.out = next();
    else if (arg === '--report-dir') args.reportDir = next();
    else if (arg === '--baseline') args.baseline = next();
    else if (arg === '--fail-on-regression') args.failOnRegression = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return args;
};

const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));

const normalizeActualMap = (value) => {
  if (!value) return new Map();
  if (Array.isArray(value)) {
    return new Map(value.map((entry) => [entry.videoId, entry.actual || entry]));
  }
  return new Map(Object.entries(value));
};

const createActualFileRunner = (actualMap) => async (fixture) => {
  if (actualMap.has(fixture.videoId)) return actualMap.get(fixture.videoId);
  return {
    status: 'technical_failure',
    failureReason: 'actual_result_missing',
    cards: [],
    metrics: {},
  };
};

export const createProbeRunner = async (deps = {}) => {
  const initLLM = deps.initLLM || (await import('../src/services/llm.service.js')).initLLM;
  const createVodBenchmarkActualRunner = deps.createVodBenchmarkActualRunner
    || (await import('../src/eval/vod-benchmark-actual-runner.js')).createVodBenchmarkActualRunner;

  initLLM();
  return createVodBenchmarkActualRunner();
};

const resultKey = (result = {}) => `${result.videoId || ''}::${result.domain || ''}`;
const REGRESSION_FROM = new Set(['passed', 'known_failure']);
const REGRESSION_TO = new Set(['failed', 'technical_failure', 'not_implemented']);

const compareBenchmarkToBaseline = (benchmark, baseline, baselinePath) => {
  const currentByKey = new Map((benchmark.results || []).map(result => [resultKey(result), result]));
  const regressions = [];
  for (const previous of baseline.results || []) {
    const current = currentByKey.get(resultKey(previous));
    if (!current) continue;
    if (REGRESSION_FROM.has(previous.status) && REGRESSION_TO.has(current.status)) {
      regressions.push({
        videoId: current.videoId,
        domain: current.domain,
        previousStatus: previous.status,
        currentStatus: current.status,
        failures: current.failures || [],
        reason: current.reason || current.failureReason || '',
      });
    }
  }
  return {
    baselinePath: resolve(baselinePath),
    regressions,
    regressionCount: regressions.length,
  };
};

const writeReportArtifacts = (reportDir, benchmark) => {
  const dir = resolve(reportDir);
  mkdirSync(dir, { recursive: true });
  const jsonPath = resolve(dir, 'vod-benchmark.json');
  const markdownPath = resolve(dir, 'vod-benchmark.md');
  writeFileSync(jsonPath, `${JSON.stringify(benchmark, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, formatVodBenchmarkReport(benchmark), 'utf8');
  return { jsonPath, markdownPath };
};

export const main = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return 0;
  }

  const fixtures = readJson(args.fixture);
  const actualMap = normalizeActualMap(args.actual ? readJson(args.actual) : null);
  const executeBenchmark = async () => {
    const runCase = args.probe
      ? await createProbeRunner()
      : createActualFileRunner(actualMap);
    return runVodBenchmarkCases(fixtures, {
      filter: args.filter,
      runCase,
    });
  };

  let benchmark;
  if (args.json && args.probe) {
    const originalLog = console.log;
    console.log = (...items) => console.error(...items);
    try {
      benchmark = await executeBenchmark();
    } finally {
      console.log = originalLog;
    }
  } else {
    benchmark = await executeBenchmark();
  }

  if (args.baseline) {
    benchmark.comparison = compareBenchmarkToBaseline(benchmark, readJson(args.baseline), args.baseline);
  }

  const shouldFailForRegression = Boolean(args.failOnRegression && benchmark.comparison?.regressions?.length > 0);

  const output = args.json
    ? `${JSON.stringify(benchmark, null, 2)}\n`
    : formatVodBenchmarkReport(benchmark);

  if (args.reportDir) {
    const artifacts = writeReportArtifacts(args.reportDir, benchmark);
    const message = `Wrote VOD benchmark artifacts: ${artifacts.jsonPath}, ${artifacts.markdownPath}`;
    if (args.json) console.error(message);
    else console.log(message);
  }

  if (args.out) {
    writeFileSync(resolve(args.out), output, 'utf8');
    console.log(`Wrote VOD benchmark report: ${resolve(args.out)}`);
  } else {
    process.stdout.write(output);
  }

  if (shouldFailForRegression) {
    console.error(`VOD benchmark regression(s): ${benchmark.comparison.regressions.length}`);
    return 1;
  }
  return 0;
};

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
