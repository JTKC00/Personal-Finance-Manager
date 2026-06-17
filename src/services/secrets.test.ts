import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {clearGeminiApiKey, loadGeminiApiKey, saveGeminiApiKey} from './secrets';

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string): string | null => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    }
  };
}

const STORAGE_KEY = 'fin_gemini_api_key';

describe('Gemini API key storage', () => {
  let storage: ReturnType<typeof createLocalStorageStub>;

  beforeEach(() => {
    storage = createLocalStorageStub();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an empty string when no key is stored', async () => {
    expect(await loadGeminiApiKey()).toBe('');
  });

  it('saves and loads the key', async () => {
    await saveGeminiApiKey('secret-key');

    expect(await loadGeminiApiKey()).toBe('secret-key');
  });

  it('trims surrounding whitespace before saving', async () => {
    await saveGeminiApiKey('  spaced-key  ');

    expect(storage.getItem(STORAGE_KEY)).toBe('spaced-key');
  });

  it('clears the stored key', async () => {
    await saveGeminiApiKey('to-be-removed');
    await clearGeminiApiKey();

    expect(await loadGeminiApiKey()).toBe('');
  });
});
