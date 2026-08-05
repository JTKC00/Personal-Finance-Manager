const LEGACY_GEMINI_API_KEY = 'fin_gemini_api_key';

/** Removes the obsolete browser-stored Gemini key after the backend migration. */
export function clearLegacyGeminiApiKey(): void {
  localStorage.removeItem(LEGACY_GEMINI_API_KEY);
}
