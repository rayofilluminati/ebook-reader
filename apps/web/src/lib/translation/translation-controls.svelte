<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { skipKeyDownListener$, writingMode$ } from '$lib/data/store';
  import { translateText, validateConfig } from './client';
  import {
    clearTranslationCache,
    loadTranslationConfig,
    saveTranslationConfig,
    translationConfig,
    translationEnabled,
    translationStatus
  } from './state';

  let dialog: HTMLDialogElement;
  let draft = { ...$translationConfig };
  let message = '';
  let testing = false;
  let testController: AbortController | undefined;
  let previousSkip = false;

  onMount(loadTranslationConfig);
  onDestroy(() => {
    translationEnabled.set(false);
    testController?.abort();
    if (dialog?.open) skipKeyDownListener$.next(previousSkip);
  });

  export function open() {
    draft = { ...$translationConfig };
    message = '';
    previousSkip = skipKeyDownListener$.getValue();
    skipKeyDownListener$.next(true);
    dialog.showModal();
  }
  function close() {
    testController?.abort();
    dialog.close();
    skipKeyDownListener$.next(previousSkip);
  }
  function save() {
    try {
      validateConfig(draft);
      translationEnabled.set(false);
      const persisted = saveTranslationConfig(draft);
      message = persisted
        ? '配置已保存。API 密钥仅保留在本次会话。'
        : '配置已用于本次会话；浏览器不允许保存设置。';
      return true;
    } catch (error) {
      message = error instanceof Error ? error.message : '配置无效。';
      return false;
    }
  }
  function start() {
    if (!save()) return;
    writingMode$.next('vertical-rl');
    translationEnabled.set(true);
    close();
  }
  async function test() {
    testing = true;
    message = '';
    testController = new AbortController();
    try {
      const result = await translateText('今日はいい天気ですね。', draft, testController.signal);
      message = `连接成功：${result}`;
    } catch (error) {
      if (!testController.signal.aborted)
        message = error instanceof Error ? error.message : '连接失败。';
    } finally {
      testing = false;
    }
  }
  function preset(endpoint: string) {
    draft = { ...draft, endpoint, apiKey: '' };
    message = '请填写该服务中已加载或可用的模型名称。';
  }
</script>

<dialog
  bind:this={dialog}
  class="translation-dialog"
  on:cancel|preventDefault={close}
  on:close={() => skipKeyDownListener$.next(previousSkip)}
>
  <div class="dialog-heading">
    <h2>沉浸式翻译</h2>
    <button aria-label="关闭翻译设置" on:click={close}>✕</button>
  </div>
  <p>日文原文与中文译文逐段对照，自上而下、从右向左竖排阅读。</p>
  <div class="presets">
    <button disabled={testing} on:click={() => preset('http://localhost:11434/v1')}>Ollama</button>
    <button disabled={testing} on:click={() => preset('http://localhost:1234/v1')}>LM Studio</button
    >
    <button disabled={testing} on:click={() => preset('https://api.openai.com/v1')}
      >云端 / 自定义</button
    >
  </div>
  <label for="translation-endpoint">API 地址（OpenAI 兼容）</label>
  <input
    id="translation-endpoint"
    type="url"
    bind:value={draft.endpoint}
    disabled={testing}
    spellcheck="false"
    placeholder="http://localhost:11434/v1"
  />
  <label for="translation-model">模型名称</label>
  <input
    id="translation-model"
    bind:value={draft.model}
    disabled={testing}
    spellcheck="false"
    placeholder="填写已下载的本地模型或云端模型 ID"
  />
  <label for="translation-key">API 密钥（本地服务通常可留空）</label>
  <input
    id="translation-key"
    type="password"
    bind:value={draft.apiKey}
    disabled={testing}
    autocomplete="off"
  />
  <p class="hint">密钥仅保存在内存中，刷新后需重新输入，不写入书籍或导出文件。</p>
  <label for="translation-target">译文</label>
  <select id="translation-target" bind:value={draft.target} disabled={testing}>
    <option value="zh-Hans">简体中文</option><option value="zh-Hant">繁體中文</option>
  </select>
  <label for="translation-instructions">翻译偏好（可选）</label>
  <textarea
    id="translation-instructions"
    bind:value={draft.instructions}
    disabled={testing}
    rows="2"
    maxlength="2000"
    placeholder="例如：保留日文人名，使用自然的文学语言。"
  />
  <p class="hint">
    开启后，仅将当前可见段落发送到所填服务。云端服务可能计费；本地服务需允许此阅读器的跨域访问。测试连接只发送示例句，不发送书籍。
  </p>
  {#if message}<p class="message" role="status">{message}</p>{/if}
  {#if $translationStatus.error}<p class="message" role="alert">{$translationStatus.error}</p>{/if}
  <div class="actions">
    <button disabled={testing} on:click={test}>{testing ? '测试中…' : '测试连接'}</button>
    <button disabled={testing} on:click={save}>保存配置</button>
    <button disabled={testing} class="primary" on:click={start}>开启竖排对照</button>
    {#if $translationEnabled}<button
        on:click={() => {
          translationEnabled.set(false);
          close();
        }}>关闭翻译</button
      >{/if}
    <button
      disabled={testing}
      on:click={() => {
        translationEnabled.set(false);
        clearTranslationCache();
        message = '会话译文缓存已清除，翻译已关闭。';
      }}>清除译文缓存</button
    >
  </div>
</dialog>

<style>
  .translation-dialog {
    writing-mode: horizontal-tb;
    color: #e5e7eb;
    background: #1f2937;
    border: 1px solid #64748b;
    border-radius: 12px;
    padding: 24px;
    width: min(560px, calc(100vw - 24px));
    max-height: calc(100dvh - 32px);
    overflow: auto;
  }
  .translation-dialog::backdrop {
    background: #0009;
  }
  .dialog-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    font-size: 1.25rem;
    font-weight: 600;
  }
  p {
    margin: 12px 0;
    font-size: 14px;
    line-height: 1.6;
  }
  label {
    display: block;
    margin: 12px 0 5px;
    font-size: 14px;
  }
  input,
  select,
  textarea {
    display: block;
    width: 100%;
    border-radius: 5px;
    border: 1px solid #64748b;
    padding: 8px;
    background: #111827;
    color: #f9fafb;
  }
  .presets,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }
  button {
    cursor: pointer;
  }
  .presets button,
  .actions button {
    border: 1px solid #64748b;
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 14px;
  }
  .actions .primary {
    background: #2563eb;
    border-color: #60a5fa;
    color: white;
  }
  button:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  .hint {
    color: #cbd5e1;
    font-size: 12px;
  }
  .message {
    padding: 8px;
    border: 1px solid #64748b;
    border-radius: 6px;
    overflow-wrap: anywhere;
  }
</style>
