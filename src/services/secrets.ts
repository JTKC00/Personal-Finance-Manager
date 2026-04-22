import * as SecureStore from 'expo-secure-store';

const GEMINI_API_KEY = 'fin_gemini_api_key';

export async function loadGeminiApiKey(): Promise<string> {
  return (await SecureStore.getItemAsync(GEMINI_API_KEY)) || '';
}

export async function saveGeminiApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(GEMINI_API_KEY, key.trim());
}

export async function clearGeminiApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(GEMINI_API_KEY);
}
