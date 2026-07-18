import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {applyStoredThemeMode, applyThemeMode, getStoredThemeMode} from './appearance';

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

const THEME_KEY = 'pfm-theme-mode';

describe('theme mode storage', () => {
  let storage: ReturnType<typeof createLocalStorageStub>;
  let root: {dataset: {theme?: string}};

  beforeEach(() => {
    storage = createLocalStorageStub();
    root = {dataset: {}};
    vi.stubGlobal('window', {localStorage: storage});
    vi.stubGlobal('document', {documentElement: root});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to light when nothing is stored', () => {
    expect(getStoredThemeMode()).toBe('light');
  });

  it('treats any non-dark stored value as light', () => {
    storage.setItem(THEME_KEY, 'system');

    expect(getStoredThemeMode()).toBe('light');
  });

  it('returns dark when dark is stored', () => {
    storage.setItem(THEME_KEY, 'dark');

    expect(getStoredThemeMode()).toBe('dark');
  });

  it('applies the mode to the document root and persists it', () => {
    applyThemeMode('dark');

    expect(root.dataset.theme).toBe('dark');
    expect(storage.getItem(THEME_KEY)).toBe('dark');
  });

  it('applies the stored mode and returns it', () => {
    storage.setItem(THEME_KEY, 'dark');

    expect(applyStoredThemeMode()).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
  });
});
