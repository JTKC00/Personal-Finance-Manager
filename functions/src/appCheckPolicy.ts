export type AppCheckStatus = 'valid' | 'missing' | 'invalid';

export type AppCheckEvaluation = {
  status: AppCheckStatus;
  allowed: boolean;
  reason?: string;
};

export async function evaluateAppCheckToken(
  token: string | undefined,
  enforce: boolean,
  verify: (token: string) => Promise<unknown>,
): Promise<AppCheckEvaluation> {
  if (!token) return {status: 'missing', allowed: !enforce};

  try {
    await verify(token);
    return {status: 'valid', allowed: true};
  } catch (error) {
    return {
      status: 'invalid',
      allowed: !enforce,
      reason: error instanceof Error ? error.message : 'Unknown App Check error',
    };
  }
}
