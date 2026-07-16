import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

test('package exposes a safe fixture-only VOD benchmark report script', () => {
  assert.equal(packageJson.scripts['benchmark:vod'], 'node scripts/run-vod-benchmark.js');
  assert.equal(
    packageJson.scripts['benchmark:vod:report'],
    'node scripts/run-vod-benchmark.js --fixture test/fixtures/vod-benchmark-cases.json --report-dir reports/vod-benchmark'
  );
  assert.doesNotMatch(packageJson.scripts['benchmark:vod:report'], /--probe/);
  assert.doesNotMatch(packageJson.scripts['benchmark:vod:report'], /--baseline/);
  assert.doesNotMatch(packageJson.scripts['benchmark:vod:report'], /--fail-on-regression/);
});
