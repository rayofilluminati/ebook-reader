/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { get } from 'svelte/store';
import { immersiveTranslation, sourceText } from '../src/lib/translation/reader-action';
import { getParagraphNodes } from '../src/lib/components/book-reader/get-paragraph-nodes';
import { defaultTranslationConfig } from '../src/lib/translation/client';
import {
  translationEnabled,
  translationConfig,
  translationStatus,
  translationRevision,
  clearTranslationCache,
  saveTranslationConfig
} from '../src/lib/translation/state';

const root = document.querySelector<HTMLElement>('#fixture')!;
const results = document.querySelector('#results')!;
const originalFetch = window.fetch;
let calls = 0;
let mode = 'success';
let active = 0;
let maximumActive = 0;
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return;
    await wait(20);
  }
  throw new Error('Timed out');
}
async function check(name: string, run: () => void | Promise<void>) {
  const item = document.createElement('li');
  try {
    await run();
    item.textContent = `PASS: ${name}`;
  } catch (error) {
    item.textContent = `FAIL: ${name}: ${error}`;
  }
  results.append(item);
}
window.fetch = async (_url, init) => {
  calls += 1;
  active += 1;
  maximumActive = Math.max(active, maximumActive);
  try {
    await wait(mode === 'slow' ? 250 : 20);
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (mode === 'error') return new Response('provider error', { status: 429 });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '<img src=x onerror=alert(1)> 今天的天气很好。' } }]
      })
    );
  } finally {
    active -= 1;
  }
};
root.innerHTML =
  '<div id="chapter"><p id="original"><ruby>今日<rt>きょう</rt><rp>（</rp></ruby>の天気はいい。<em>本当だ。</em></p><p>次の段落です。</p></div>';
const original = root.querySelector<HTMLElement>('#original')!;
const originalNodes = getParagraphNodes(root);
const count = originalNodes.map((node) => node.textContent).join('');
translationConfig.set({ ...defaultTranslationConfig, model: 'mock' });
const action = immersiveTranslation(root, () => {});
await check('disabled mode sends no requests', async () => {
  await wait(100);
  assert(calls === 0, 'unexpected request');
});
await check('extracts ruby base text without reading aids', () => {
  assert(sourceText(original) === '今日の天気はいい。本当だ。', 'ruby contamination');
});
translationEnabled.set(true);
await check('visible paragraphs translate serially and untrusted output stays text', async () => {
  await until(() => root.querySelectorAll('[data-ttu-translation]').length === 2);
  assert(maximumActive === 1, 'parallel requests');
  assert(!root.querySelector('img'), 'HTML injection');
  assert(
    root.querySelector('[data-ttu-translation]')?.textContent?.includes('<img'),
    'missing literal text'
  );
});
await check('original nodes, ruby and counted source text are preserved', () => {
  assert(originalNodes[0].isConnected, 'original node replaced');
  assert(root.querySelector('rt')?.textContent === 'きょう', 'ruby removed');
  assert(
    getParagraphNodes(root)
      .map((node) => node.textContent)
      .join('') === count,
    'translation counted'
  );
});
await check('turning off removes translations; reopening uses the session cache', async () => {
  const before = calls;
  translationEnabled.set(false);
  assert(!root.querySelector('[data-ttu-translation]'), 'translation remains');
  translationEnabled.set(true);
  await until(() => root.querySelectorAll('[data-ttu-translation]').length === 2);
  assert(calls === before, 'cache miss');
});
await check('API keys are not persisted', () => {
  saveTranslationConfig({ ...defaultTranslationConfig, model: 'mock', apiKey: 'test-secret' });
  assert(
    !localStorage.getItem('ttu-translation-config-v1')?.includes('test-secret'),
    'key persisted'
  );
});
await check('chapter replacement translates fresh content without stale nodes', async () => {
  root.innerHTML = '<div><p>別の章です。</p></div>';
  await until(() => !!root.querySelector('[data-ttu-translation]'));
  assert(root.querySelectorAll('[data-ttu-translation]').length === 1, 'stale translations');
});
await check('provider errors pause the queue; explicit retry resumes', async () => {
  mode = 'error';
  root.innerHTML = '<div><p>失敗する段落。</p><p>待つ段落。</p></div>';
  await until(() => !!get(translationStatus).error);
  const before = calls;
  await wait(100);
  assert(before === calls, 'retried without user action');
  mode = 'success';
  translationRevision.update((value) => value + 1);
  await until(() => root.querySelectorAll('[data-ttu-translation]').length === 2);
  assert(!get(translationStatus).error, 'error remains');
});
await check('stop cancels in-flight translation and prevents stale insertion', async () => {
  mode = 'slow';
  root.innerHTML = '<p>遅いモデル。</p>';
  await until(() => get(translationStatus).busy);
  translationEnabled.set(false);
  await wait(300);
  assert(!root.querySelector('[data-ttu-translation]'), 'late insertion');
});
await check('offscreen paragraphs are not sent until scrolled into view', async () => {
  mode = 'success';
  root.innerHTML = '<div style="height:1000px"></div><p>まだ見えない文章。</p>';
  root.scrollTop = 0;
  const before = calls;
  translationEnabled.set(true);
  await wait(150);
  assert(calls === before, 'offscreen request');
  root.scrollTop = 1000;
  await until(() => !!root.querySelector('[data-ttu-translation]'));
});
action.destroy();
translationEnabled.set(false);
clearTranslationCache();
localStorage.removeItem('ttu-translation-config-v1');
window.fetch = originalFetch;
document.title = results.textContent?.includes('FAIL:')
  ? 'FAIL — translation tests'
  : 'PASS — translation tests';
