export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'pfm-theme-mode';

export function getStoredThemeMode(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

export function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  window.localStorage.setItem(THEME_KEY, mode);
}

export function applyStoredThemeMode(): ThemeMode {
  const mode = getStoredThemeMode();
  document.documentElement.dataset.theme = mode;
  return mode;
}
