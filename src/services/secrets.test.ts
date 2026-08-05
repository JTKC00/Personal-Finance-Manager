import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {clearLegacyGeminiApiKey} from './secrets';

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

describe('legacy Gemini API key cleanup', () => {
  let storage: ReturnType<typeof createLocalStorageStub>;

  beforeEach(() => {
    storage = createLocalStorageStub();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('removes the legacy key without creating another value', () => {
    storage.setItem(STORAGE_KEY, 'to-be-removed');
    const setItem = vi.spyOn(storage, 'setItem');

    clearLegacyGeminiApiKey();

    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  });
});
