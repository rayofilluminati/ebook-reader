import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  completionUrl,
  defaultTranslationConfig,
  splitTranslationText,
  translateText
} from '../src/lib/translation/client.ts';

const config = { ...defaultTranslationConfig, model: 'test-model' };
const response = (text, reason = 'stop') =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: text }, finish_reason: reason }] })
  );

test('normalizes base and complete endpoints without duplicating paths', () => {
  assert.equal(
    completionUrl('http://localhost:11434/v1/'),
    'http://localhost:11434/v1/chat/completions'
  );
  assert.equal(
    completionUrl('https://example.org/api/v1/chat/completions'),
    'https://example.org/api/v1/chat/completions'
  );
  for (const endpoint of [
    'javascript:alert(1)',
    'https://secret@example.org/v1',
    'http://example.org/v1',
    'https://example.org/v1?key=secret'
  ]) {
    assert.throws(() => completionUrl(endpoint));
  }
});

test('splits long paragraphs without dropping punctuation or splitting astral characters', () => {
  const text = '日本語。𠮟る！\n'.repeat(500);
  const chunks = splitTranslationText(text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 1800));
});

test('uses non-streaming compatible API and passes the requested model and Chinese target', async () => {
  let calls = 0;
  const result = await translateText(
    '日本語',
    { ...config, apiKey: 'secret', target: 'zh-Hant' },
    new AbortController().signal,
    async (url, init) => {
      calls += 1;
      assert.equal(url, 'http://localhost:11434/v1/chat/completions');
      assert.equal(init.headers.Authorization, 'Bearer secret');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'test-model');
      assert.equal(body.stream, false);
      assert.match(body.messages[0].content, /繁体中文/);
      assert.equal(body.messages[1].content, '日本語');
      return response('日語');
    }
  );
  assert.equal(result, '日語');
  assert.equal(calls, 1);
});

test('local service may omit Authorization and long requests run serially', async () => {
  let calls = 0;
  const result = await translateText(
    'あ'.repeat(4000),
    config,
    new AbortController().signal,
    async (_url, init) => {
      assert.equal(init.headers.Authorization, undefined);
      calls += 1;
      return response(`译文${calls}`);
    }
  );
  assert.equal(calls, 3);
  assert.equal(result, '译文1\n译文2\n译文3');
});

test('handles provider failures without echoing response body or credentials', async () => {
  await assert.rejects(
    translateText(
      '日本語',
      config,
      new AbortController().signal,
      async () => new Response('secret-book-and-key', { status: 401 })
    ),
    (error) => /401/.test(error.message) && !/secret/.test(error.message)
  );
  await assert.rejects(
    translateText('日本語', config, new AbortController().signal, async () => response('')),
    /有效译文/
  );
  await assert.rejects(
    translateText('日本語', config, new AbortController().signal, async () =>
      response('partial', 'length')
    ),
    /截断/
  );
  await assert.rejects(
    translateText('日本語', config, new AbortController().signal, async () => {
      throw new TypeError('fetch failed');
    }),
    /CORS/
  );
});

test('cancellation aborts an in-flight fetch and does not start subsequent chunks', async () => {
  const controller = new AbortController();
  let calls = 0;
  const work = translateText('あ'.repeat(4000), config, controller.signal, async (_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) =>
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    );
  });
  controller.abort();
  await assert.rejects(work, { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(
    translateText('日本語', config, controller.signal, async () => {
      throw new Error('must not fetch');
    }),
    { name: 'AbortError' }
  );
});
