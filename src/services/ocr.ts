import {OcrResult} from '../types/finance';
import {auth, getAppCheckHeaders} from './firebase';
import {normalizeLegacyOcrResult} from './ocrLogic';

// 生產環境：透過 firebase.json hosting rewrite 把 /api/ocr 轉發到 Cloud Function
// 開發環境：vite.config.ts 的 server.proxy 負責轉發，或可用 VITE_OCR_PROXY_URL 覆寫
const OCR_ENDPOINT = import.meta.env.VITE_OCR_PROXY_URL || '/api/ocr';

export type OcrUsageStatus = {
  date: string;
  userCount: number;
  globalCount: number;
  userLimit: number;
  globalLimit: number;
  userRemaining: number;
  globalRemaining: number;
  remaining: number;
};

export type OcrScanResult = {
  result: OcrResult;
  rawJson: string;
  model: string;
  promptVersion: string;
  schemaVersion: number;
  usage?: OcrUsageStatus;
};

async function getAuthHeaders(): Promise<Record<string, string>> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) {
    throw new Error('請先登入後再使用 OCR 掃描。');
  }

  return {
    Authorization: `Bearer ${idToken}`,
    ...await getAppCheckHeaders()
  };
}

export async function loadOcrUsageStatus(): Promise<OcrUsageStatus> {
  const headers = await getAuthHeaders();
  const response = await fetch(OCR_ENDPOINT, {headers});

  if (!response.ok) {
    const errData = await response.json().catch(() => null);
    const backendMsg = errData?.error || errData?.message || null;
    throw new Error(backendMsg || `OCR 用量查詢失敗（HTTP ${response.status}）`);
  }

  return response.json();
}

export async function scanReceipt(imageBase64: string, mimeType = 'image/jpeg'): Promise<OcrScanResult> {
  const headers = await getAuthHeaders();
  const response = await fetch(OCR_ENDPOINT, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      imageBase64,
      mimeType
    })
  });

  if (!response.ok) {
    // 嘗試讀取後端回傳的實際錯誤訊息，而非固定字串
    const errData = await response.json().catch(() => null);
    const backendMsg = errData?.error || errData?.message || null;
    throw new Error(backendMsg || `OCR 請求失敗（HTTP ${response.status}）`);
  }

  const data = await response.json();
  const providerResult = data.result || data;
  const result = normalizeLegacyOcrResult(providerResult);
  return {
    result,
    // Legacy endpoints did not return rawJson. Persist only their parsed OCR value,
    // never the surrounding response envelope (which may contain provider metadata).
    rawJson: typeof data.rawJson === 'string' ? data.rawJson : JSON.stringify(result),
    model: typeof data.model === 'string' ? data.model : 'unknown',
    promptVersion: typeof data.promptVersion === 'string' ? data.promptVersion : 'legacy-v1',
    schemaVersion: typeof data.schemaVersion === 'number' ? data.schemaVersion : 1,
    usage: data.usage,
  };
}
