import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 24 * 1024 * 1024;

function loadLocalEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnv();

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const GEMINI_FALLBACK_MODELS = parseModelList(process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.1-flash-lite,gemini-2.5-flash')
  .filter(model => model !== GEMINI_MODEL);
const GEMINI_MODELS = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];
const GEMINI_MAX_ATTEMPTS_PER_MODEL = readPositiveInt('GEMINI_MAX_ATTEMPTS_PER_MODEL', 3);
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();

function readPositiveInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function parseModelList(value) {
  return [...new Set(value.split(',').map(model => model.trim()).filter(Boolean))];
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end('Not found');
      return;
    }
    res.writeHead(200, {'Content-Type': contentType});
    res.end(data);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseGeminiJsonResponse(data) {
  const text = (data.candidates || [])
    .flatMap(candidate => (candidate.content && candidate.content.parts) || [])
    .map(part => part.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini response did not include text');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

function getGeminiErrorMessage(data) {
  const error = data && data.error;
  const message = typeof error?.message === 'string' ? error.message : '';
  const status = typeof error?.status === 'string' ? error.status : '';
  const code = typeof error?.code === 'number' || typeof error?.code === 'string' ? String(error.code) : '';
  return [message, status && `status=${status}`, code && `code=${code}`].filter(Boolean).join(' ');
}

function isTransientGeminiStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms) {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms));
}

async function requestGeminiModel(model, apiKey, payload) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(async () => ({
    error: {message: await response.text().catch(() => 'Unable to read Gemini error response')}
  }));

  if (!response.ok) {
    const error = new Error(getGeminiErrorMessage(data) || `Gemini request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.model = model;
    error.detail = data;
    throw error;
  }

  return data;
}

async function requestGeminiWithFallback(apiKey, payload) {
  let lastError = null;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
      try {
        const data = await requestGeminiModel(model, apiKey, payload);
        return {
          data,
          model,
          attempts: attempt,
          fallbackUsed: model !== GEMINI_MODEL
        };
      } catch (error) {
        lastError = error;
        console.warn(JSON.stringify({
          event: 'gemini_attempt_failed',
          model,
          attempt,
          status: error.status,
          reason: 'Gemini request failed'
        }));

        if (!isTransientGeminiStatus(error.status)) throw error;
        if (attempt < GEMINI_MAX_ATTEMPTS_PER_MODEL) {
          await sleep(400 * attempt);
        }
      }
    }
  }

  throw lastError || new Error('Gemini request failed');
}

async function handleOcr(req, res) {
  try {
    const body = await readJsonBody(req);
    const {imageBase64, mimeType = 'image/jpeg', today = new Date().toISOString().slice(0, 10)} = body;
    const apiKey = GEMINI_API_KEY;

    if (!apiKey) {
      sendJson(res, 500, {error: 'Server configuration error'});
      return;
    }

    if (!imageBase64) {
      sendJson(res, 400, {error: 'imageBase64 is required'});
      return;
    }

    const payload = {
      contents: [{
        parts: [
          {inline_data: {mime_type: mimeType, data: imageBase64}},
          {text: `分析這張收據/發票，僅回傳 JSON。格式必須符合：{"amount": 數字金額, "category": "餐飲/交通/購物/娛樂/醫療/居住/金融支出/學習/禮物/旅遊/保險/家庭/其他 其中之一", "note": "商戶或簡短描述", "date": "YYYY-MM-DD；若看不出則用今天 ${today}"}。不要加 Markdown，不要加解釋。`}
        ]
      }],
      generationConfig: {
        temperature: 0,
        response_mime_type: 'application/json'
      }
    };
    const gemini = await requestGeminiWithFallback(apiKey, payload);

    sendJson(res, 200, {
      result: parseGeminiJsonResponse(gemini.data),
      model: gemini.model,
      fallbackUsed: gemini.fallbackUsed,
      attempts: gemini.attempts
    });
  } catch (error) {
    const status = Number.isFinite(error.status) ? error.status : 500;
    sendJson(res, status, {
      error: status === 500 ? 'OCR failed' : 'Gemini request failed'
    });
  }
}

// 如需使用這個本地 OCR proxy，請用環境變數指定正式站來源，避免把私人網址提交到 repo。
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 處理瀏覽器的 CORS preflight 請求 (OPTIONS)
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ocr') {
    handleOcr(req, res);
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, {error: 'Method not allowed'});
    return;
  }

  if (url.pathname === '/' || url.pathname === '/personal_finance_manager.html') {
    sendFile(res, path.join(ROOT, 'personal_finance_manager.html'), 'text/html; charset=utf-8');
    return;
  }

  sendJson(res, 404, {error: 'Not found'});
});

server.listen(PORT, HOST, () => {
  console.log(`Personal Finance Manager prototype: http://${HOST}:${PORT}`);
  console.log(`Gemini OCR models: ${GEMINI_MODELS.join(', ')}`);
});
