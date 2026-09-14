/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { get } from 'svelte/store';
import { translateText, type TranslationConfig } from './client';
import {
  cacheTranslation,
  cachedTranslation,
  translationCacheKey,
  translationConfig,
  translationEnabled,
  translationRevision,
  translationStatus
} from './state';

const blockSelector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,dd,dt,div,td,th,figcaption';
const ignoredSelector =
  'rt,rp,script,style,noscript,[hidden],[aria-hidden="true"],[data-ttu-translation]';

export function sourceText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(ignoredSelector).forEach((node) => node.remove());
  return clone.textContent?.trim() || '';
}

export function translationParagraphs(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(blockSelector)).filter(
    (element) =>
      !element.closest(ignoredSelector) &&
      !element.querySelector(blockSelector) &&
      /[\u3040-\u30ff\u3400-\u9fff]/u.test(sourceText(element))
  );
}

interface Entry {
  source: HTMLElement;
  text: string;
  output?: HTMLElement;
  done: boolean;
}

export function immersiveTranslation(root: HTMLElement, onLayout: () => void) {
  let version = 0;
  let disposed = false;
  let observer: IntersectionObserver | undefined;
  let request: AbortController | undefined;
  let entries: Entry[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  const mutation = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(restart, 0);
  });

  function watch() {
    if (!disposed) mutation.observe(root, { childList: true, subtree: true });
  }

  function layoutChange(change: () => void) {
    // Preserve the first visible source paragraph when continuous content expands.
    const continuous = !root.querySelector('.book-content-container');
    const anchor = continuous
      ? entries.find(({ source }) => {
          const rect = source.getBoundingClientRect();
          return (
            rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight
          );
        })?.source
      : undefined;
    const before = anchor?.getBoundingClientRect();
    mutation.disconnect();
    change();
    watch();
    if (anchor && before && anchor.isConnected) {
      const after = anchor.getBoundingClientRect();
      const vertical = root.classList.contains('book-content--writing-vertical-rl');
      window.scrollBy(
        vertical ? after.right - before.right : 0,
        vertical ? 0 : after.top - before.top
      );
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(onLayout);
  }

  function reset() {
    version += 1;
    request?.abort();
    observer?.disconnect();
    mutation.disconnect();
    const remove = () => entries.forEach(({ output }) => output?.remove());
    if (!disposed && entries.some(({ output }) => output?.isConnected)) layoutChange(remove);
    else remove();
    mutation.disconnect();
    entries = [];
  }

  function restart() {
    reset();
    translationStatus.set({ busy: false, completed: 0, error: '' });
    if (disposed || !get(translationEnabled)) {
      watch();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(onLayout);
      return;
    }
    const run = version;
    const config: TranslationConfig = { ...get(translationConfig) };
    entries = translationParagraphs(root).map((source) => ({
      source,
      text: sourceText(source),
      done: false
    }));
    const bySource = new Map(entries.map((entry) => [entry.source, entry]));
    const visible = new Set<Entry>();
    let running = false;
    let halted = false;
    let completed = 0;

    async function pump() {
      if (running || halted || disposed || run !== version) return;
      running = true;
      try {
        for (const entry of visible) {
          if (disposed || run !== version) return;
          if (entry.done || !entry.source.isConnected) continue;
          request = new AbortController();
          translationStatus.set({ busy: true, completed, error: '' });
          const key = translationCacheKey(entry.text, config);
          const result =
            cachedTranslation(key) ?? (await translateText(entry.text, config, request.signal));
          if (disposed || run !== version || !entry.source.isConnected) return;
          cacheTranslation(key, result);
          layoutChange(() => {
            const output = document.createElement('span');
            output.dataset.ttuTranslation = '';
            output.lang = config.target;
            output.className = 'ttu-translation';
            // Model output is untrusted text, never HTML.
            output.textContent = result;
            entry.source.append(output);
            entry.output = output;
            entry.done = true;
          });
          completed += 1;
          observer?.unobserve(entry.source);
        }
      } catch (error) {
        if (run !== version || disposed) return;
        halted = true;
        translationStatus.set({
          busy: false,
          completed,
          error: error instanceof Error ? error.message : '翻译失败，请重试。'
        });
      } finally {
        running = false;
        if (!disposed && run === version && !halted)
          translationStatus.set({ busy: false, completed, error: '' });
      }
    }

    observer = new IntersectionObserver((changes) => {
      for (const change of changes) {
        const entry = bySource.get(change.target as HTMLElement);
        if (!entry) continue;
        if (change.isIntersecting) visible.add(entry);
        else visible.delete(entry);
      }
      void pump();
    });
    entries.forEach(({ source }) => observer?.observe(source));
    watch();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(onLayout);
  }

  const unsubscribers = [
    translationEnabled.subscribe(restart),
    translationConfig.subscribe(restart),
    translationRevision.subscribe(restart)
  ];
  return {
    update(callback: () => void) {
      onLayout = callback;
    },
    destroy() {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      reset();
    }
  };
}
