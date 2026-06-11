const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

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

async function handleOcr(req, res) {
  try {
    const body = await readJsonBody(req);
    const {imageBase64, mimeType = 'image/jpeg', today = new Date().toISOString().slice(0, 10)} = body;
    const userKey = (req.headers['x-gemini-api-key'] || body.geminiApiKey || '').toString().trim();
    const apiKey = userKey || GEMINI_API_KEY;

    if (!apiKey) {
      sendJson(res, 400, {error: 'Gemini API key is required'});
      return;
    }

    if (!imageBase64) {
      sendJson(res, 400, {error: 'imageBase64 is required'});
      return;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
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
      })
    });

    const data = await response.json();
    if (!response.ok) {
      sendJson(res, response.status, {error: 'Gemini request failed', detail: data});
      return;
    }

    sendJson(res, 200, {result: parseGeminiJsonResponse(data), model: GEMINI_MODEL});
  } catch (error) {
    sendJson(res, 500, {error: error.message || 'OCR failed'});
  }
}

// 如需使用這個本地 OCR proxy，請用環境變數指定正式站來源，避免把私人網址提交到 repo。
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 處理瀏覽器的 CORS preflight 請求 (OPTIONS)
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-gemini-api-key');

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
  console.log(`Gemini OCR model: ${GEMINI_MODEL}`);
});
