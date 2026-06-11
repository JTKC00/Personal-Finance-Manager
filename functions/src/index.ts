import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

// 把 Gemini API Key 存在 Cloud Secret Manager（安全，不會寫死在 code 裡）
const geminiApiKey = defineSecret('GEMINI_API_KEY');

const GEMINI_MODEL = 'gemini-3.5-flash';
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const OCR_DAILY_LIMIT_PER_USER = readPositiveInt('OCR_DAILY_LIMIT_PER_USER', 20);
const OCR_DAILY_LIMIT_GLOBAL = readPositiveInt('OCR_DAILY_LIMIT_GLOBAL', 50);
const REQUIRE_APP_CHECK = process.env.REQUIRE_APP_CHECK === 'true';

class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaError';
  }
}

function readPositiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

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

function logOcrEvent(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    event,
    service: 'ocr',
    timestamp: new Date().toISOString(),
    ...data,
  }));
}

async function verifyAppCheckToken(token: string | undefined): Promise<boolean> {
  if (!REQUIRE_APP_CHECK) return true;
  if (!token) return false;

  try {
    await getAppCheck().verifyToken(token);
    return true;
  } catch (error) {
    logOcrEvent('app_check_rejected', {
      reason: error instanceof Error ? error.message : 'Unknown App Check error',
    });
    return false;
  }
}

function getTodayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getUsageRefs(uid: string, dateKey = getTodayKey()) {
  const dailyRef = db.doc(`ocrUsage/${dateKey}`);
  const userRef = dailyRef.collection('users').doc(uid);
  return {dailyRef, userRef, dateKey};
}

async function getUsageStatus(uid: string) {
  const {dailyRef, userRef, dateKey} = getUsageRefs(uid);
  const [dailySnap, userSnap] = await Promise.all([dailyRef.get(), userRef.get()]);
  const globalCount = Number(dailySnap.data()?.count || 0);
  const userCount = Number(userSnap.data()?.count || 0);
  const userRemaining = Math.max(0, OCR_DAILY_LIMIT_PER_USER - userCount);
  const globalRemaining = Math.max(0, OCR_DAILY_LIMIT_GLOBAL - globalCount);

  return {
    date: dateKey,
    userCount,
    globalCount,
    userLimit: OCR_DAILY_LIMIT_PER_USER,
    globalLimit: OCR_DAILY_LIMIT_GLOBAL,
    userRemaining,
    globalRemaining,
    remaining: Math.min(userRemaining, globalRemaining),
  };
}

async function reserveOcrQuota(uid: string) {
  const {dailyRef, userRef, dateKey} = getUsageRefs(uid);

  return db.runTransaction(async transaction => {
    const [dailySnap, userSnap] = await Promise.all([
      transaction.get(dailyRef),
      transaction.get(userRef),
    ]);
    const globalCount = Number(dailySnap.data()?.count || 0);
    const userCount = Number(userSnap.data()?.count || 0);

    if (globalCount >= OCR_DAILY_LIMIT_GLOBAL) {
      throw new QuotaError('今日 OCR 全站額度已用完，請明天再試。');
    }
    if (userCount >= OCR_DAILY_LIMIT_PER_USER) {
      throw new QuotaError('今日 OCR 掃描次數已用完，請明天再試。');
    }

    transaction.set(dailyRef, {
      count: FieldValue.increment(1),
      limit: OCR_DAILY_LIMIT_GLOBAL,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    transaction.set(userRef, {
      count: FieldValue.increment(1),
      limit: OCR_DAILY_LIMIT_PER_USER,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    const nextGlobalCount = globalCount + 1;
    const nextUserCount = userCount + 1;
    const userRemaining = Math.max(0, OCR_DAILY_LIMIT_PER_USER - nextUserCount);
    const globalRemaining = Math.max(0, OCR_DAILY_LIMIT_GLOBAL - nextGlobalCount);

    return {
      date: dateKey,
      userCount: nextUserCount,
      globalCount: nextGlobalCount,
      userLimit: OCR_DAILY_LIMIT_PER_USER,
      globalLimit: OCR_DAILY_LIMIT_GLOBAL,
      userRemaining,
      globalRemaining,
      remaining: Math.min(userRemaining, globalRemaining),
    };
  });
}

export const ocr = onRequest(
  {
    secrets: [geminiApiKey],
    invoker: 'public',    // 允許 Firebase Hosting rewrite 呼叫（v2 函式預設需要 IAM 驗證）
    cors: true,           // 允許瀏覽器跨域呼叫
    maxInstances: 3,      // 控制最大並發，避免超出免費額度
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (req, res) => {
    const startedAt = Date.now();

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const appCheckOk = await verifyAppCheckToken(req.get('x-firebase-appcheck'));
    if (!appCheckOk) {
      res.status(401).json({ error: 'App Check verification failed' });
      return;
    }

    const idToken = getBearerToken(req.get('authorization'));
    if (!idToken) {
      logOcrEvent('auth_missing', {method: req.method});
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    let uid: string;
    try {
      const decodedToken = await getAuth().verifyIdToken(idToken);
      uid = decodedToken.uid;
    } catch {
      logOcrEvent('auth_invalid', {method: req.method});
      res.status(401).json({ error: 'Invalid authentication token' });
      return;
    }

    if (req.method === 'GET') {
      try {
        const usage = await getUsageStatus(uid);
        logOcrEvent('usage_loaded', {
          uid,
          remaining: usage.remaining,
          durationMs: Date.now() - startedAt,
        });
        res.json(usage);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unable to load OCR usage';
        logOcrEvent('usage_failed', {
          uid,
          reason: msg,
          durationMs: Date.now() - startedAt,
        });
        res.status(500).json({ error: msg });
      }
      return;
    }

    try {
      const body = req.body;

      // 檢查 body 大小
      const bodyStr = JSON.stringify(body);
      if (Buffer.byteLength(bodyStr) > MAX_BODY_BYTES) {
        logOcrEvent('request_too_large', {uid, durationMs: Date.now() - startedAt});
        res.status(413).json({ error: 'Request body too large' });
        return;
      }

      const { imageBase64, mimeType = 'image/jpeg', today = new Date().toISOString().slice(0, 10) } = body;
      // 優先用用戶自己的 key，否則用 Cloud Secret
      const apiKey = (body.geminiApiKey || '').toString().trim() || geminiApiKey.value();

      if (!apiKey) {
        logOcrEvent('api_key_missing', {uid, durationMs: Date.now() - startedAt});
        res.status(400).json({ error: 'Gemini API key is required' });
        return;
      }
      if (!imageBase64) {
        logOcrEvent('image_missing', {uid, durationMs: Date.now() - startedAt});
        res.status(400).json({ error: 'imageBase64 is required' });
        return;
      }

      const usage = await reserveOcrQuota(uid);

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
                { text: `分析這張收據/發票，僅回傳 JSON。格式必須符合：{"amount": 數字金額, "category": "餐飲/交通/購物/娛樂/醫療/居住/金融支出/學習/禮物/旅遊/保險/家庭/其他 其中之一", "note": "商戶或簡短描述", "date": "YYYY-MM-DD；若看不出則用今天 ${today}"}。不要加 Markdown，不要加解釋。` }
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
        logOcrEvent('gemini_failed', {
          uid,
          status: response.status,
          usageRemaining: usage.remaining,
          durationMs: Date.now() - startedAt,
        });
        res.status(response.status).json({ error: 'Gemini request failed', detail: data });
        return;
      }

      logOcrEvent('scan_completed', {
        uid,
        model: GEMINI_MODEL,
        usageRemaining: usage.remaining,
        durationMs: Date.now() - startedAt,
      });
      res.json({ result: parseGeminiJsonResponse(data), model: GEMINI_MODEL, usage });
    } catch (error) {
      if (error instanceof QuotaError) {
        logOcrEvent('quota_exceeded', {
          uid,
          reason: error.message,
          durationMs: Date.now() - startedAt,
        });
        res.status(429).json({ error: error.message, usage: await getUsageStatus(uid) });
        return;
      }
      const msg = error instanceof Error ? error.message : 'OCR failed';
      logOcrEvent('scan_failed', {
        uid,
        reason: msg,
        durationMs: Date.now() - startedAt,
      });
      res.status(500).json({ error: msg });
    }
  }
);
