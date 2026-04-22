import {OcrResult} from '../types/finance';

declare const process: {env?: Record<string, string | undefined>} | undefined;

const OCR_ENDPOINT = process?.env?.EXPO_PUBLIC_OCR_PROXY_URL || 'http://localhost:5173/api/ocr';

export async function scanReceipt(imageBase64: string, mimeType = 'image/jpeg', geminiApiKey = ''): Promise<OcrResult> {
  const response = await fetch(OCR_ENDPOINT, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      imageBase64,
      mimeType,
      today: new Date().toISOString().slice(0, 10),
      geminiApiKey
    })
  });

  if (!response.ok) {
    throw new Error(`OCR proxy failed with ${response.status}`);
  }

  const data = await response.json();
  return data.result || data;
}
