import {OcrResult} from '../types/finance';

// 生產環境：透過 firebase.json hosting rewrite 把 /api/ocr 轉發到 Cloud Function
// 開發環境：vite.config.ts 的 server.proxy 負責轉發，或可用 VITE_OCR_PROXY_URL 覆寫
const OCR_ENDPOINT = import.meta.env.VITE_OCR_PROXY_URL || '/api/ocr';

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
    // 嘗試讀取後端回傳的實際錯誤訊息，而非固定字串
    const errData = await response.json().catch(() => null);
    const backendMsg = errData?.error || errData?.message || null;
    throw new Error(backendMsg || `OCR 請求失敗（HTTP ${response.status}）`);
  }

  const data = await response.json();
  return data.result || data;
}
