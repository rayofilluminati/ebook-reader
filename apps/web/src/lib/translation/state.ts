/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { writable } from 'svelte/store';
import { defaultTranslationConfig, type TranslationConfig } from './client';

export const translationConfig = writable<TranslationConfig>({ ...defaultTranslationConfig });
// Never persist activation: only an explicit reader action can send book text.
export const translationEnabled = writable(false);
export const translationRevision = writable(0);
export const translationStatus = writable({ busy: false, completed: 0, error: '' });
const storageKey = 'ttu-translation-config-v1';
let loaded = false;

export function loadTranslationConfig() {
  if (loaded) return;
  loaded = true;
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || '{}');
    translationConfig.set({
      endpoint:
        typeof data.endpoint === 'string' ? data.endpoint : defaultTranslationConfig.endpoint,
      model: typeof data.model === 'string' ? data.model : '',
      target: data.target === 'zh-Hant' ? 'zh-Hant' : 'zh-Hans',
      instructions: typeof data.instructions === 'string' ? data.instructions : '',
      apiKey: ''
    });
  } catch {
    // Storage may be disabled. The reader still works with session-only settings.
  }
}

export function saveTranslationConfig(config: TranslationConfig): boolean {
  translationConfig.set({ ...config });
  try {
    const { apiKey: _apiKey, ...publicConfig } = config;
    localStorage.setItem(storageKey, JSON.stringify(publicConfig));
    return true;
  } catch {
    return false;
  }
}

// A bounded session cache. Book text, translations and API keys never enter exports.
const cache = new Map<string, string>();
export function translationCacheKey(text: string, config: TranslationConfig): string {
  return JSON.stringify([config.endpoint, config.model, config.target, config.instructions, text]);
}
export function cachedTranslation(key: string) {
  return cache.get(key);
}
export function cacheTranslation(key: string, text: string) {
  cache.delete(key);
  cache.set(key, text);
  while (cache.size > 500) cache.delete(cache.keys().next().value!);
}
export function clearTranslationCache() {
  cache.clear();
  translationRevision.update((revision) => revision + 1);
}
