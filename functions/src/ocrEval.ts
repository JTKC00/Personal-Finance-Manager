import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {applicationDefault} from 'firebase-admin/app';
import {GeminiRequestError, requestGeminiModel} from './geminiClient.js';
import {
  type GeminiPayload,
  type OcrConfidence,
  type OcrExtraction,
  createOcrV2Payload,
  extractGeminiText,
  OcrSchemaError,
  parseGeminiOcrResponse,
} from './ocrContract.js';

type ExpectedValues = {
  amount: number;
  merchant: string;
  category: string;
  date: string;
  paymentMethod: '信用卡' | '現金' | '電子錢包' | null;
};

type EvalCase = {
  id: string;
  image: string;
  mimeType?: string;
  tags: string[];
  expected: ExpectedValues;
};

type EvalManifest = {version: 1; cases: EvalCase[]};
type Profile = 'legacy-v1' | 'candidate-v2';

type EvalOutput = {
  amount: number | null;
  merchant: string | null;
  category: string;
  date: string | null;
  paymentMethods: string[];
  confidence?: OcrExtraction['modelConfidence'];
};

type CaseCorrectness = {
  amount: boolean;
  merchant: boolean;
  date: boolean;
  category: boolean;
  paymentTop1: boolean | null;
  paymentTopK: boolean | null;
  allCoreFields: boolean;
};

type EvalCaseResult = {
  id: string;
  profile: Profile;
  output?: EvalOutput;
  correctness?: CaseCorrectness;
  failureReason?: string;
};

type ProfileMetrics = {
  profile: Profile;
  model: string;
  caseCount: number;
  schemaValid: number;
  amountExact: number;
  dateExact: number;
  merchantNormalizedExact: number;
  categoryExact: number;
  paymentTop1Exact: number;
  paymentTopKExact: number;
  paymentExpectedCount: number;
  allCoreFieldsExact: number;
  failureReasons: Record<string, number>;
  confidence: Record<string, Record<OcrConfidence, {correct: number; total: number}>>;
};

function readArg(name: string, fallback = ''): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function normalizeMerchant(value: string | null): string {
  return (value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-HK')
    .replace(/有限公司|limited|\bltd\.?\b/g, '')
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function inferMimeType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.heic') return 'image/heic';
  return 'image/jpeg';
}

function createLegacyPayload(imageBase64: string, mimeType: string): GeminiPayload {
  return {
    contents: [{parts: [
      {inlineData: {mimeType, data: imageBase64}},
      {text: '分析這張收據/發票，僅回傳 JSON。格式：{"amount": 數字金額, "category": "餐飲/交通/購物/娛樂/醫療/居住/金融支出/學習/禮物/旅遊/保險/家庭/其他", "note": "商戶或簡短描述", "date": "YYYY-MM-DD"}。不要加 Markdown或解釋。'},
    ]}],
    generationConfig: {responseMimeType: 'application/json'},
  };
}

function parseLegacy(data: Record<string, unknown>): EvalOutput {
  const parsed = JSON.parse(extractGeminiText(data)) as Record<string, unknown>;
  if (typeof parsed.amount !== 'number' || typeof parsed.category !== 'string' || typeof parsed.date !== 'string') {
    throw new Error('legacy schema invalid');
  }
  return {
    amount: parsed.amount,
    merchant: null,
    category: parsed.category,
    date: parsed.date,
    paymentMethods: [],
  };
}

async function accessSecret(project: string, secret: string): Promise<string> {
  const token = await applicationDefault().getAccessToken();
  const name = `projects/${encodeURIComponent(project)}/secrets/${encodeURIComponent(secret)}/versions/latest`;
  const response = await fetch(`https://secretmanager.googleapis.com/v1/${name}:access`, {
    headers: {Authorization: `Bearer ${token.access_token}`},
  });
  if (!response.ok) throw new Error(`Secret Manager access failed with HTTP ${response.status}`);
  const data = await response.json() as {payload?: {data?: string}};
  const encoded = data.payload?.data;
  if (!encoded) throw new Error('Secret Manager response did not contain a payload');
  return Buffer.from(encoded, 'base64').toString('utf8').trim();
}

function emptyConfidenceMetrics(): ProfileMetrics['confidence'] {
  return Object.fromEntries(
    ['amount', 'merchant', 'date', 'category', 'paymentMethod'].map(field => [field, {
      high: {correct: 0, total: 0},
      medium: {correct: 0, total: 0},
      low: {correct: 0, total: 0},
    }]),
  );
}

function createMetrics(profile: Profile, model: string, caseCount: number): ProfileMetrics {
  return {
    profile, model, caseCount, schemaValid: 0, amountExact: 0, dateExact: 0,
    merchantNormalizedExact: 0, categoryExact: 0, paymentTop1Exact: 0,
    paymentTopKExact: 0, paymentExpectedCount: 0, allCoreFieldsExact: 0,
    failureReasons: {},
    confidence: emptyConfidenceMetrics(),
  };
}

function classifyFailure(error: unknown): string {
  if (error instanceof GeminiRequestError) {
    const detail = error.message.toLowerCase();
    if (detail.includes('responseformat')) return `request-http-${error.status}-response-format`;
    if (detail.includes('schema')) return `request-http-${error.status}-schema`;
    if (detail.includes('model')) return `request-http-${error.status}-model`;
    return `request-http-${error.status}`;
  }
  if (error instanceof OcrSchemaError) return 'response-schema-validation';
  if (error instanceof SyntaxError) return 'response-json-parse';
  if (error instanceof Error && 'code' in error) return 'local-file-read';
  return 'unexpected';
}

function recordConfidence(
  metrics: ProfileMetrics,
  output: EvalOutput,
  expected: ExpectedValues,
) {
  if (!output.confidence) return;
  const correctness: Record<keyof OcrExtraction['modelConfidence'], boolean> = {
    amount: output.amount === expected.amount,
    merchant: normalizeMerchant(output.merchant) === normalizeMerchant(expected.merchant),
    date: output.date === expected.date,
    category: output.category === expected.category,
    paymentMethod: output.paymentMethods[0] === expected.paymentMethod,
  };
  (Object.keys(correctness) as Array<keyof typeof correctness>).forEach(field => {
    const level = output.confidence?.[field] || 'low';
    metrics.confidence[field][level].total += 1;
    if (correctness[field]) metrics.confidence[field][level].correct += 1;
  });
}

function score(metrics: ProfileMetrics, output: EvalOutput, expected: ExpectedValues): CaseCorrectness {
  metrics.schemaValid += 1;
  const amountCorrect = output.amount === expected.amount;
  const dateCorrect = output.date === expected.date;
  const merchantCorrect = normalizeMerchant(output.merchant) === normalizeMerchant(expected.merchant);
  const categoryCorrect = output.category === expected.category;
  const paymentTop1Correct = expected.paymentMethod ? output.paymentMethods[0] === expected.paymentMethod : null;
  const paymentTopKCorrect = expected.paymentMethod ? output.paymentMethods.includes(expected.paymentMethod) : null;
  const allCoreFieldsCorrect = amountCorrect && dateCorrect && categoryCorrect;
  if (amountCorrect) metrics.amountExact += 1;
  if (dateCorrect) metrics.dateExact += 1;
  if (merchantCorrect) metrics.merchantNormalizedExact += 1;
  if (categoryCorrect) metrics.categoryExact += 1;
  if (expected.paymentMethod) {
    metrics.paymentExpectedCount += 1;
    if (paymentTop1Correct) metrics.paymentTop1Exact += 1;
    if (paymentTopKCorrect) metrics.paymentTopKExact += 1;
  }
  if (allCoreFieldsCorrect) metrics.allCoreFieldsExact += 1;
  recordConfidence(metrics, output, expected);
  return {
    amount: amountCorrect,
    merchant: merchantCorrect,
    date: dateCorrect,
    category: categoryCorrect,
    paymentTop1: paymentTop1Correct,
    paymentTopK: paymentTopKCorrect,
    allCoreFields: allCoreFieldsCorrect,
  };
}

function rate(value: number, total: number): number | null {
  return total ? Number((value / total).toFixed(4)) : null;
}

function summarizeMetrics(metrics: ProfileMetrics) {
  return {
    ...metrics,
    rates: {
      schemaValid: rate(metrics.schemaValid, metrics.caseCount),
      amountExact: rate(metrics.amountExact, metrics.caseCount),
      dateExact: rate(metrics.dateExact, metrics.caseCount),
      merchantNormalizedExact: rate(metrics.merchantNormalizedExact, metrics.caseCount),
      categoryExact: rate(metrics.categoryExact, metrics.caseCount),
      paymentTop1Exact: rate(metrics.paymentTop1Exact, metrics.paymentExpectedCount),
      paymentTopKExact: rate(metrics.paymentTopKExact, metrics.paymentExpectedCount),
      allCoreFieldsExact: rate(metrics.allCoreFieldsExact, metrics.caseCount),
    },
    confidenceRates: Object.fromEntries(Object.entries(metrics.confidence).map(([field, levels]) => [
      field,
      Object.fromEntries(Object.entries(levels).map(([level, counts]) => [level, rate(counts.correct, counts.total)])),
    ])),
  };
}

async function runProfile(
  profile: Profile,
  manifest: EvalManifest,
  datasetDir: string,
  apiKey: string,
  model: string,
): Promise<{metrics: ProfileMetrics; caseResults: EvalCaseResult[]}> {
  const metrics = createMetrics(profile, model, manifest.cases.length);
  const caseResults: EvalCaseResult[] = [];
  for (const testCase of manifest.cases) {
    try {
      const imagePath = path.resolve(datasetDir, testCase.image);
      const imageBase64 = (await readFile(imagePath)).toString('base64');
      const mimeType = testCase.mimeType || inferMimeType(imagePath);
      const payload = profile === 'candidate-v2'
        ? createOcrV2Payload(imageBase64, mimeType)
        : createLegacyPayload(imageBase64, mimeType);
      const response = await requestGeminiModel(model, apiKey, payload);
      const output = profile === 'candidate-v2'
        ? (() => {
            const parsed = parseGeminiOcrResponse(response).result;
            return {
              amount: parsed.amount,
              merchant: parsed.merchant,
              category: parsed.category,
              date: parsed.date,
              paymentMethods: parsed.paymentMethodCandidates.map(candidate => candidate.method),
              confidence: parsed.modelConfidence,
            };
          })()
        : parseLegacy(response);
      const correctness = score(metrics, output, testCase.expected);
      caseResults.push({id: testCase.id, profile, output, correctness});
    } catch (error) {
      // Case data and provider responses are deliberately not logged.
      const reason = classifyFailure(error);
      metrics.failureReasons[reason] = (metrics.failureReasons[reason] || 0) + 1;
      caseResults.push({id: testCase.id, profile, failureReason: reason});
    }
  }
  return {metrics, caseResults};
}

function validateManifest(value: unknown): EvalManifest {
  if (typeof value !== 'object' || value === null) throw new Error('manifest must be an object');
  const manifest = value as Partial<EvalManifest>;
  if (manifest.version !== 1 || !Array.isArray(manifest.cases) || !manifest.cases.length) {
    throw new Error('manifest must be version 1 and contain at least one case');
  }
  for (const item of manifest.cases) {
    if (!item.id || !item.image || !item.expected || !Array.isArray(item.tags)) throw new Error('manifest case is incomplete');
  }
  return manifest as EvalManifest;
}

async function main() {
  const datasetDir = path.resolve(readArg('dataset', '../ocr-eval-private'));
  const project = readArg('project', 'personal-finance-manager-8e8b4');
  const secret = readArg('secret', 'GEMINI_API_KEY');
  const model = readArg('model', 'gemini-3.6-flash');
  const requestedProfile = readArg('profile');
  const manifestPath = path.join(datasetDir, 'manifest.json');
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  const apiKey = await accessSecret(project, secret);
  if (requestedProfile && requestedProfile !== 'legacy-v1' && requestedProfile !== 'candidate-v2') {
    throw new Error('--profile must be legacy-v1 or candidate-v2');
  }
  const profiles: Profile[] = requestedProfile
    ? [requestedProfile as Profile]
    : ['legacy-v1', 'candidate-v2'];
  const evaluations = [];
  for (const profile of profiles) evaluations.push(await runProfile(profile, manifest, datasetDir, apiKey, model));

  const report = {
    version: 1,
    createdAt: new Date().toISOString(),
    project,
    model,
    promptComparison: profiles,
    metrics: evaluations.map(evaluation => summarizeMetrics(evaluation.metrics)),
    caseResults: evaluations.flatMap(evaluation => evaluation.caseResults),
  };
  const resultsDir = path.join(datasetDir, 'results');
  await mkdir(resultsDir, {recursive: true});
  const outputPath = path.join(resultsDir, `${report.createdAt.replace(/[:.]/g, '-')}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  console.log(JSON.stringify({event: 'ocr_eval_completed', caseCount: manifest.cases.length, model, outputPath}));
}

main().catch(error => {
  console.error(JSON.stringify({
    event: 'ocr_eval_failed',
    reason: error instanceof Error ? error.message : 'Unknown evaluation error',
  }));
  process.exitCode = 1;
});
