# VOD Benchmark Workflow

This document describes the VOD (Video-on-Demand) benchmark pipeline — its workflow, usage patterns, artifact location policy, baseline management, and guardrails.

## Overview

The VOD benchmark evaluates the fact-check overlay pipeline against a curated set of video fixtures. Each fixture defines an expected behavior (`no_card`, `cards_required`, or `cards_allowed`) with domain-specific guard expectations. The benchmark runner compares the pipeline's _actual_ output against these expectations and produces a structured report with result statuses such as `passed`, `failed`, `known_failure`, `not_implemented`, and `technical_failure`.

## Workflow Modes

### 1. Fixture-Only Benchmark (Default, No Live Dependencies)

Runs the benchmark against fixture definitions without network calls, transcript downloads, or Gemini API calls. If no `--actual` JSON is supplied, the CLI intentionally reports `technical_failure` / `actual_result_missing`; use that as a workflow smoke check, not as product-quality signal. Supply `--actual` when validating expected benchmark outcomes.

```bash
# Using the default fixture file and writing report artifacts (safe smoke check)
npm run benchmark:vod:report

# With custom fixture and actual files
node scripts/run-vod-benchmark.js \
  --fixture test/fixtures/vod-benchmark-cases.json \
  --actual test/fixtures/vod-actual-results.json \
  --report-dir reports/vod-benchmark

# JSON output for CI consumption
node scripts/run-vod-benchmark.js \
  --fixture test/fixtures/vod-benchmark-cases.json \
  --actual test/fixtures/vod-actual-results.json \
  --json
```

**Use when**: validating expectation logic, running in CI, reproducing results, testing regression detection.

### 2. Controlled Probe Mode (Transcript + Extractor)

Downloads YouTube transcripts and runs the VOD topic extractor against each fixture, but uses the configured (probe-friendly) extractor path. Requires a valid `GEMINI_API_KEY` in the runtime environment for the extractor to function.

```bash
node scripts/run-vod-benchmark.js \
  --fixture test/fixtures/vod-benchmark-cases.json \
  --probe \
  --report-dir reports/vod-probe
```

**Use when**: testing extractor behavior against real videos, investigating low-claim-density detection, validating title-transcript alignment.

**Caveat**: `GEMINI_API_KEY` must be set in `.env` (or `.env.local`, `.env.development`) for probe mode to work fully. Fixtures whose expected behavior relies on Gemini extraction may degrade or fail without it.

### 3. Live Mode (Full Pipeline)

Not yet available as a separate npm script. For interactive use, pass `--probe` directly (see probe mode above). A future "live" mode will connect to the running backend services.

### 4. Single-Case Quick Check

Run one fixture in isolation during development:

```bash
node scripts/run-vod-benchmark.js \
  --fixture test/fixtures/vod-benchmark-cases.json \
  --actual test/fixtures/vod-actual-results.json \
  --case jNQXAC9IVRw
```

## Artifact Location Policy

- **CI runs**: use `--report-dir reports/vod-benchmark/` (relative to `backend/`). This path is git-ignored by the default `reports/` pattern if one exists, or should be added to `.gitignore`.
- **One-off exploration**: use a `tmp/` directory, e.g. `--report-dir tmp/vod-probe-YYYYMMDD`. These are temporary and should not be committed.
- **Baseline storage**: baseline JSON files live under `backend/test/baselines/vod-benchmark/` with naming convention `vod-benchmark-baseline-YYYY-MM-DD.json`.
- **Shared baselines**: the latest stable baseline is tracked in `backend/test/baselines/vod-benchmark/vod-benchmark-baseline-latest.json`. Update this after validating the baseline is acceptable (see baseline update policy below).

### Example Report Directory Structure

```
backend/
  reports/
    vod-benchmark/
      vod-benchmark.json       # Machine-readable results
      vod-benchmark.md         # Human-readable report
  test/
    baselines/
      vod-benchmark/
        vod-benchmark-baseline-2026-07-15.json
        vod-benchmark-baseline-latest.json
```

## Baseline Management

### What Is a Baseline?

A baseline is a snapshot of a previous benchmark run (the full `vod-benchmark.json` artifact). It serves as the reference point for regression detection.

### Creating a Baseline

```bash
# Run a fixture-only benchmark and capture the artifact
node scripts/run-vod-benchmark.js \
  --fixture test/fixtures/vod-benchmark-cases.json \
  --actual test/fixtures/vod-actual-results.json \
  --report-dir tmp/vod-baseline-candidate

# Review the artifact, then copy to baselines directory
cp tmp/vod-baseline-candidate/vod-benchmark.json \
  test/baselines/vod-benchmark/vod-benchmark-baseline-2026-07-16.json
cp tmp/vod-baseline-candidate/vod-benchmark.json \
  test/baselines/vod-benchmark/vod-benchmark-baseline-latest.json
```

### Baseline Update Policy

Update the baseline when:

| Situation | Action |
|---|---|
| New fixtures added | Run a full benchmark without `--fail-on-regression`, verify all new cases produce acceptable results, then update |
| Expected behavior changed for existing fixtures | Update fixture JSON, re-benchmark, verify, update baseline |
| Extractor/runner logic improved | Run probe or fixture mode, verify regressions are false-positives (or expected improvements), then update |
| Regression introduced unintentionally | **Do NOT update the baseline** — fix the regression first |

**Rule of thumb**: if `--fail-on-regression` returns exit code `1`, investigate the regression before updating the baseline. Only update after the new results are verified as intentionally better or when fixture expectations change.

### Using `--fail-on-regression`

```bash
# CI check: fail if any previously-passing case now fails
node scripts/run-vod-benchmark.js \
  --fixture test/fixtures/vod-benchmark-cases.json \
  --actual test/fixtures/vod-actual-results.json \
  --baseline test/baselines/vod-benchmark/vod-benchmark-baseline-latest.json \
  --fail-on-regression \
  --json
```

## Available npm Scripts

```bash
npm run benchmark:vod          # Full CLI, pass your own flags after --
npm run benchmark:vod:report   # Safe fixture-only report artifact smoke check; no --probe/live calls
```

## Guardrails

### Pure Runner Must Stay Provider-Free

The core runner (`src/eval/vod-benchmark-runner.js`) must not import transcript, Gemini, VOD services, or any provider-specific code. It takes an injected `runCase(fixture)` function. All provider-dependent logic lives in:
- `src/eval/vod-benchmark-actual-runner.js` (probe mode)
- CLI script (`scripts/run-vod-benchmark.js`) (orchestration)

### Probe Must Be Explicit

The `--probe` flag must be passed explicitly for probe mode. The default (no `--probe`, no `--actual`) maps all results to `technical_failure` with reason `actual_result_missing`.

### JSON stdout Must Stay Parseable

When `--json` is combined with `--probe`, log output (dotenv, video metadata, transcript loading) is redirected to stderr. Fixture-only mode has no logs on stdout by design.

### Missing GEMINI_API_KEY in Probe Mode

If `GEMINI_API_KEY` is not set in the runtime environment, probe mode cases that require the Gemini-backed extractor will likely fail with a `technical_failure` status. Fixture-only mode is unaffected.

### Regression Detection Semantics

A regression is detected when a result that was previously `passed` or `known_failure` becomes `failed`, `technical_failure`, or `not_implemented`. Other transitions (e.g. `not_implemented` → `passed`) are considered improvements and are not flagged.

### Exit Codes

| Exit Code | Meaning |
|---|---|
| 0 | Success — all benchmarks completed, no regressions (or regression check not enabled) |
| 1 | Regressions detected (when `--fail-on-regression` is set) or CLI argument error |

## Quick Reference

```bash
# Fixture-only report artifact smoke check (default fixture file)
npm run benchmark:vod:report

# Fixture-only with custom files
node scripts/run-vod-benchmark.js \
  --fixture path/to/fixtures.json \
  --actual path/to/actuals.json

# Probe mode (requires GEMINI_API_KEY)
node scripts/run-vod-benchmark.js \
  --fixture test/fixtures/vod-benchmark-cases.json \
  --probe \
  --report-dir reports/vod-probe

# Single case
node scripts/run-vod-benchmark.js \
  --fixture test/fixtures/vod-benchmark-cases.json \
  --actual test/fixtures/vod-actual-results.json \
  --case jNQXAC9IVRw

# Regression check
node scripts/run-vod-benchmark.js \
  --fixture test/fixtures/vod-benchmark-cases.json \
  --actual test/fixtures/vod-actual-results.json \
  --baseline test/baselines/vod-benchmark/vod-benchmark-baseline-latest.json \
  --fail-on-regression

# JSON output to stdout
node scripts/run-vod-benchmark.js \
  --fixture test/fixtures/vod-benchmark-cases.json \
  --actual test/fixtures/vod-actual-results.json \
  --json

# Report directory (writes .json and .md)
node scripts/run-vod-benchmark.js \
  --fixture test/fixtures/vod-benchmark-cases.json \
  --actual test/fixtures/vod-actual-results.json \
  --report-dir reports/vod-benchmark
```
