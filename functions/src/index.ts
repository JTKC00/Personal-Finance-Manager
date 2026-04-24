import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

initializeApp();

// 把 Gemini API Key 存在 Cloud Secret Manager（安全，不會寫死在 code 裡）
const geminiApiKey = defineSecret('GEMINI_API_KEY');

const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const MAX_BODY_BYTES = 24 * 1024 * 1024;

function parseGeminiJsonResponse(data: Record<string, unknown>): unknown {
  const candidates = data.candidates as Array<{content?: {parts?: Array<{text?: string}>}}> || [];
  const text = candidates
    .flatMap(c => c.content?.parts || [])
    .map(p => p.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini response did not include text');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

function getBearerToken(authorizationHeader: string | undefined): string {
  const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export const ocr = onRequest(
  {
    secrets: [geminiApiKey],
    invoker: 'public',    // 允許 Firebase Hosting rewrite 呼叫（v2 函式預設需要 IAM 驗證）
    cors: true,           // 允許瀏覽器跨域呼叫
    maxInstances: 10,     // 控制最大並發，避免超出免費額度
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const idToken = getBearerToken(req.get('authorization'));
    if (!idToken) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      await getAuth().verifyIdToken(idToken);
    } catch {
      res.status(401).json({ error: 'Invalid authentication token' });
      return;
    }

    try {
      const body = req.body;

      // 檢查 body 大小
      const bodyStr = JSON.stringify(body);
      if (Buffer.byteLength(bodyStr) > MAX_BODY_BYTES) {
        res.status(413).json({ error: 'Request body too large' });
        return;
      }

      const { imageBase64, mimeType = 'image/jpeg', today = new Date().toISOString().slice(0, 10) } = body;
      // 優先用用戶自己的 key，否則用 Cloud Secret
      const apiKey = (body.geminiApiKey || '').toString().trim() || geminiApiKey.value();

      if (!apiKey) {
        res.status(400).json({ error: 'Gemini API key is required' });
        return;
      }
      if (!imageBase64) {
        res.status(400).json({ error: 'imageBase64 is required' });
        return;
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: mimeType, data: imageBase64 } },
                { text: `分析這張收據/發票，僅回傳 JSON。格式必須符合：{"amount": 數字金額, "category": "餐飲/交通/購物/娛樂/醫療/居住/水電/其他 其中之一", "note": "商戶或簡短描述", "date": "YYYY-MM-DD；若看不出則用今天 ${today}"}。不要加 Markdown，不要加解釋。` }
              ]
            }],
            generationConfig: {
              temperature: 0,
              response_mime_type: 'application/json',
            },
          }),
        }
      );

      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        res.status(response.status).json({ error: 'Gemini request failed', detail: data });
        return;
      }

      res.json({ result: parseGeminiJsonResponse(data), model: GEMINI_MODEL });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'OCR failed';
      res.status(500).json({ error: msg });
    }
  }
);
