import { onRequest } from 'firebase-functions/v2/https';
import { defineBoolean, defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {evaluateAppCheckToken} from './appCheckPolicy.js';
import {GeminiRequestError, requestGeminiWithFallback} from './geminiClient.js';
import {
  OCR_PROMPT_VERSION,
  OCR_SCHEMA_VERSION,
  OcrSchemaError,
  createOcrV2Payload,
  parseGeminiOcrResponse,
} from './ocrContract.js';

initializeApp();
const db = getFirestore();

// 把 Gemini API Key 存在 Cloud Secret Manager（安全，不會寫死在 code 裡）
const geminiApiKey = defineSecret('GEMINI_API_KEY');
const requireAppCheck = defineBoolean('REQUIRE_APP_CHECK', {default: false});

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_FALLBACK_MODELS = parseModelList(process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.1-flash-lite,gemini-2.5-flash')
  .filter(model => model !== GEMINI_MODEL);
const GEMINI_MODELS = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];
const GEMINI_MAX_ATTEMPTS_PER_MODEL = readPositiveInt('GEMINI_MAX_ATTEMPTS_PER_MODEL', 3);
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const OCR_DAILY_LIMIT_PER_USER = readPositiveInt('OCR_DAILY_LIMIT_PER_USER', 20);
const OCR_DAILY_LIMIT_GLOBAL = readPositiveInt('OCR_DAILY_LIMIT_GLOBAL', 50);

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

function parseModelList(value: string): string[] {
  return [...new Set(value.split(',').map(model => model.trim()).filter(Boolean))];
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

async function evaluateAppCheckRequest(token: string | undefined) {
  const enforce = requireAppCheck.value();
  const evaluation = await evaluateAppCheckToken(
    token,
    enforce,
    value => getAppCheck().verifyToken(value),
  );
  logOcrEvent('app_check_evaluated', {
    mode: enforce ? 'enforce' : 'observe',
    status: evaluation.status,
    ...(evaluation.reason ? {reason: evaluation.reason} : {}),
  });
  return evaluation;
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
    cors: false,
    maxInstances: 3,      // 控制最大並發，避免超出免費額度
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (req, res) => {
    const startedAt = Date.now();

    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Firebase-AppCheck',
      'Access-Control-Expose-Headers': 'X-App-Check-Status',
    });

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const appCheck = await evaluateAppCheckRequest(req.get('x-firebase-appcheck'));
    res.set('X-App-Check-Status', appCheck.status);
    if (!appCheck.allowed) {
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

      const {imageBase64, mimeType = 'image/jpeg'} = body;
      const apiKey = geminiApiKey.value().trim();

      if (!apiKey) {
        logOcrEvent('api_key_missing', {uid, durationMs: Date.now() - startedAt});
        res.status(500).json({ error: 'Server configuration error' });
        return;
      }
      if (!imageBase64) {
        logOcrEvent('image_missing', {uid, durationMs: Date.now() - startedAt});
        res.status(400).json({ error: 'imageBase64 is required' });
        return;
      }

      const usage = await reserveOcrQuota(uid);

      const gemini = await requestGeminiWithFallback(
        apiKey,
        createOcrV2Payload(imageBase64, mimeType),
        {
          models: GEMINI_MODELS,
          maxAttemptsPerModel: GEMINI_MAX_ATTEMPTS_PER_MODEL,
          onAttemptFailed: detail => logOcrEvent('gemini_attempt_failed', {
            ...detail,
            reason: 'Gemini request failed',
          }),
        },
      );
      const parsed = parseGeminiOcrResponse(gemini.data);

      logOcrEvent('scan_completed', {
        uid,
        model: gemini.model,
        fallbackUsed: gemini.fallbackUsed,
        attempts: gemini.attempts,
        usageRemaining: usage.remaining,
        durationMs: Date.now() - startedAt,
      });
      res.json({
        result: parsed.result,
        rawJson: parsed.rawJson,
        model: gemini.model,
        promptVersion: OCR_PROMPT_VERSION,
        schemaVersion: OCR_SCHEMA_VERSION,
        usage,
      });
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
      if (error instanceof GeminiRequestError) {
        logOcrEvent('gemini_failed', {
          uid,
          model: error.model,
          status: error.status,
          reason: 'Gemini request failed',
          durationMs: Date.now() - startedAt,
        });
        res.status(error.status).json({
          error: 'Gemini request failed',
        });
        return;
      }
      if (error instanceof OcrSchemaError) {
        logOcrEvent('schema_validation_failed', {
          uid,
          issueCount: error.issues.length,
          durationMs: Date.now() - startedAt,
        });
        res.status(502).json({error: 'OCR result validation failed'});
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
