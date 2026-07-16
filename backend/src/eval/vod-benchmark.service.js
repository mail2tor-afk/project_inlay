const VALID_BEHAVIORS = new Set(['no_card', 'cards_allowed', 'cards_required', 'known_failure']);
const RESULT_STATUSES = ['passed', 'failed', 'known_failure', 'not_implemented', 'technical_failure'];

const normalize = (value) => typeof value === 'string'
  ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  : '';

const asArray = (value) => Array.isArray(value) ? value : [];
const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const cardText = (card = {}) => [
  card.topicTitle,
  card.claim,
  card.question,
  card.normalizedClaim,
  card.exactQuote,
].map(normalize).filter(Boolean).join(' ');

const textIncludes = (haystack, needle) => {
  const h = normalize(haystack).toLowerCase();
  const n = normalize(needle).toLowerCase();
  return Boolean(h && n && h.includes(n));
};

export const validateVodBenchmarkCase = (fixture = {}) => {
  const errors = [];
  if (!normalize(fixture.videoId)) errors.push('videoId is required');
  if (!normalize(fixture.domain)) errors.push('domain is required');
  if (!VALID_BEHAVIORS.has(fixture.expectedBehavior)) errors.push('expectedBehavior is invalid');

  if (fixture.expectedBehavior === 'no_card') {
    if (!normalize(fixture.expectedNoCardReason)) errors.push('expectedNoCardReason is required for no_card');
    if (asNumber(fixture.allowedMaxCards, 0) !== 0) errors.push('no_card fixture must set allowedMaxCards to 0');
  }

  if (fixture.expectedBehavior === 'cards_required') {
    if (asNumber(fixture.minCards, 0) < 1) errors.push('cards_required fixture must set minCards >= 1');
    if (asNumber(fixture.maxCards, 0) < asNumber(fixture.minCards, 0)) errors.push('maxCards must be >= minCards');
    const expectedThemeCount = asArray(fixture.expectedTopThemes).length;
    if (expectedThemeCount === 0) errors.push('cards_required fixture needs expectedTopThemes');
    const minThemeMatches = asNumber(fixture.minExpectedThemeMatches, Math.min(asNumber(fixture.minCards, 1), expectedThemeCount));
    if (expectedThemeCount > 0 && (minThemeMatches < 1 || minThemeMatches > expectedThemeCount)) {
      errors.push('minExpectedThemeMatches must be between 1 and expectedTopThemes.length');
    }
  }

  if (fixture.expectedBehavior === 'known_failure' && !normalize(fixture.knownFailureReason)) {
    errors.push('knownFailureReason is required for known_failure');
  }

  return { valid: errors.length === 0, errors };
};

const evaluateMustNotSelect = (fixture, actual, failures) => {
  const acceptedText = asArray(actual.cards).map(cardText).join(' | ');
  for (const forbidden of asArray(fixture.mustNotSelect)) {
    if (textIncludes(acceptedText, forbidden)) failures.push(`mustNotSelect accepted: ${forbidden}`);
  }
};

const evaluateGuardExpectations = (fixture, actual, failures) => {
  const expected = fixture.guardExpectations || {};
  const metrics = actual.metrics || {};
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (expectedValue === 'not_implemented') continue;
    const actualValue = metrics[key];
    if (typeof expectedValue === 'number') {
      if (asNumber(actualValue, Number.NaN) !== expectedValue) failures.push(`${key} expected ${expectedValue} got ${actualValue}`);
    } else if (actualValue !== expectedValue) {
      failures.push(`${key} expected ${expectedValue} got ${actualValue}`);
    }
  }
};

const evaluateExpectedThemes = (fixture, actual, failures) => {
  const cards = asArray(actual.cards);
  const cardsText = cards.map(cardText).join(' | ');
  const expectedThemes = asArray(fixture.expectedTopThemes);
  const matched = expectedThemes.filter(theme => textIncludes(cardsText, theme));
  if (fixture.expectedBehavior === 'cards_required') {
    const requiredMatches = asNumber(
      fixture.minExpectedThemeMatches,
      Math.min(asNumber(fixture.minCards, 1), expectedThemes.length),
    );
    if (matched.length < requiredMatches) {
      failures.push(`expectedTopThemes matched ${matched.length}/${expectedThemes.length}; required ${requiredMatches}`);
    }
  }

  if (fixture.expectedBehavior === 'cards_allowed' && cards.length > 0 && expectedThemes.length > 0) {
    const requiredMatches = asNumber(fixture.minExpectedThemeMatches, 1);
    if (matched.length < requiredMatches) {
      failures.push(`expectedTopThemes matched ${matched.length}/${expectedThemes.length}; required ${requiredMatches}`);
    }
  }
};

export const evaluateVodBenchmarkCase = (fixture = {}, actual = {}) => {
  const validation = validateVodBenchmarkCase(fixture);
  if (!validation.valid) {
    return {
      videoId: fixture.videoId,
      domain: fixture.domain,
      status: 'failed',
      failures: validation.errors,
    };
  }

  if (fixture.expectedBehavior === 'known_failure') {
    return {
      videoId: fixture.videoId,
      domain: fixture.domain,
      status: 'known_failure',
      reason: fixture.knownFailureReason,
      failures: [],
    };
  }

  if (actual.status === 'technical_failure') {
    return {
      videoId: fixture.videoId,
      domain: fixture.domain,
      status: 'technical_failure',
      reason: actual.failureReason || 'technical_failure',
      failures: [],
    };
  }

  const failures = [];
  const cards = asArray(actual.cards);

  if (fixture.expectedBehavior === 'no_card') {
    if (actual.status !== 'no_card' && actual.status !== 'no_claims') failures.push(`expected no_card got ${actual.status || 'unknown'}`);
    if (cards.length > asNumber(fixture.allowedMaxCards, 0)) failures.push(`expected <=${fixture.allowedMaxCards} cards got ${cards.length}`);
    if (fixture.expectedNoCardReason && actual.noCardReason !== fixture.expectedNoCardReason) {
      failures.push(`expected noCardReason ${fixture.expectedNoCardReason} got ${actual.noCardReason || 'unknown'}`);
    }
  }

  if (fixture.expectedBehavior === 'cards_required') {
    const minCards = asNumber(fixture.minCards, 1);
    const maxCards = asNumber(fixture.maxCards, Number.POSITIVE_INFINITY);
    if (cards.length < minCards) failures.push(`expected at least ${minCards} cards got ${cards.length}`);
    if (cards.length > maxCards) failures.push(`expected at most ${maxCards} cards got ${cards.length}`);
    evaluateExpectedThemes(fixture, actual, failures);
  }

  if (fixture.expectedBehavior === 'cards_allowed') {
    const maxCards = fixture.maxCards == null ? Number.POSITIVE_INFINITY : asNumber(fixture.maxCards, Number.POSITIVE_INFINITY);
    if (cards.length > maxCards) failures.push(`expected at most ${maxCards} cards got ${cards.length}`);
    evaluateExpectedThemes(fixture, actual, failures);
  }

  evaluateMustNotSelect(fixture, actual, failures);
  evaluateGuardExpectations(fixture, actual, failures);

  return {
    videoId: fixture.videoId,
    domain: fixture.domain,
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
  };
};

export const summarizeVodBenchmarkResults = (results = []) => {
  const summary = Object.fromEntries(RESULT_STATUSES.map(status => [status, 0]));
  for (const result of results) {
    const status = RESULT_STATUSES.includes(result?.status) ? result.status : 'failed';
    summary[status] += 1;
  }
  return { total: results.length, ...summary };
};
