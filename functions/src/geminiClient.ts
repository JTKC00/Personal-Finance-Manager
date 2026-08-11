import type {GeminiPayload} from './ocrContract.js';

export class GeminiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly model: string,
    public readonly detail: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GeminiRequestError';
  }
}

function getGeminiErrorMessage(data: Record<string, unknown>): string {
  const error = data.error as {message?: unknown; status?: unknown; code?: unknown} | undefined;
  const message = typeof error?.message === 'string' ? error.message : '';
  const status = typeof error?.status === 'string' ? error.status : '';
  const code = typeof error?.code === 'number' || typeof error?.code === 'string' ? String(error.code) : '';
  return [message, status && `status=${status}`, code && `code=${code}`].filter(Boolean).join(' ');
}

function isTransientGeminiStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function requestGeminiModel(
  model: string,
  apiKey: string,
  payload: GeminiPayload,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': apiKey},
      body: JSON.stringify(payload),
    },
  );

  const data = await response.json().catch(async () => ({
    error: {message: await response.text().catch(() => 'Unable to read Gemini error response')},
  })) as Record<string, unknown>;

  if (!response.ok) {
    throw new GeminiRequestError(
      getGeminiErrorMessage(data) || `Gemini request failed with HTTP ${response.status}`,
      response.status,
      model,
      data,
    );
  }
  return data;
}

export async function requestGeminiWithFallback(
  apiKey: string,
  payload: GeminiPayload,
  options: {
    models: string[];
    maxAttemptsPerModel: number;
    onAttemptFailed?: (detail: {model: string; attempt: number; status: number}) => void;
  },
) {
  let lastError: GeminiRequestError | null = null;
  const primaryModel = options.models[0];

  for (const model of options.models) {
    for (let attempt = 1; attempt <= options.maxAttemptsPerModel; attempt += 1) {
      try {
        return {
          data: await requestGeminiModel(model, apiKey, payload),
          model,
          attempts: attempt,
          fallbackUsed: model !== primaryModel,
        };
      } catch (error) {
        if (!(error instanceof GeminiRequestError)) throw error;
        lastError = error;
        options.onAttemptFailed?.({model, attempt, status: error.status});
        if (!isTransientGeminiStatus(error.status)) throw error;
        if (attempt < options.maxAttemptsPerModel) await sleep(400 * attempt);
      }
    }
  }
  throw lastError || new Error('Gemini request failed');
}

