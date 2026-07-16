import assert from 'node:assert/strict';
import test from 'node:test';

const importConfig = async () => import(`../src/config/index.js?case=${Date.now()}-${Math.random()}`);

const withEnv = async (env, fn) => {
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousGoogle = process.env.GOOGLE_API_KEY;

  if ('GEMINI_API_KEY' in env) process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = '';

  if ('GOOGLE_API_KEY' in env) process.env.GOOGLE_API_KEY = env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = '';

  try {
    await fn();
  } finally {
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGemini;

    if (previousGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = previousGoogle;
  }
};

test('config reads Gemini API key from GEMINI_API_KEY env', async () => {
  await withEnv({ GEMINI_API_KEY: 'gemini-env-key' }, async () => {
    const { config } = await importConfig();

    assert.equal(config.gemini.apiKey, 'gemini-env-key');
  });
});

test('config falls back to GOOGLE_API_KEY env for Gemini clients', async () => {
  await withEnv({ GOOGLE_API_KEY: 'google-env-key' }, async () => {
    const { config } = await importConfig();

    assert.equal(config.gemini.apiKey, 'google-env-key');
  });
});

test('GEMINI_API_KEY takes precedence over GOOGLE_API_KEY', async () => {
  await withEnv({ GEMINI_API_KEY: 'gemini-env-key', GOOGLE_API_KEY: 'google-env-key' }, async () => {
    const { config } = await importConfig();

    assert.equal(config.gemini.apiKey, 'gemini-env-key');
  });
});
