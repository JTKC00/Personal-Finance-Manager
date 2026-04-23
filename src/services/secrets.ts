const GEMINI_API_KEY = 'fin_gemini_api_key';

export async function loadGeminiApiKey(): Promise<string> {
  return localStorage.getItem(GEMINI_API_KEY) ?? '';
}

export async function saveGeminiApiKey(key: string): Promise<void> {
  localStorage.setItem(GEMINI_API_KEY, key.trim());
}

export async function clearGeminiApiKey(): Promise<void> {
  localStorage.removeItem(GEMINI_API_KEY);
}
