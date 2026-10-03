export const REQUIRED_HOSTING_ENV = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateHostingEnv(env) {
  const errors = [];

  for (const key of REQUIRED_HOSTING_ENV) {
    if (!hasValue(env[key])) errors.push(`缺少必要 production env：${key}`);
  }

  if (String(env.VITE_USE_FIREBASE_EMULATORS || '').trim().toLowerCase() === 'true') {
    errors.push('VITE_USE_FIREBASE_EMULATORS 不可在 production Hosting deploy 設為 true');
  }

  if (hasValue(env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN)) {
    errors.push('VITE_FIREBASE_APPCHECK_DEBUG_TOKEN 不可帶入 production Hosting build');
  }

  return errors;
}
