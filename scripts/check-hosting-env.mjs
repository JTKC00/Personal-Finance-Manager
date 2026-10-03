import process from 'node:process';
import {loadEnv} from 'vite';
import {REQUIRED_HOSTING_ENV, validateHostingEnv} from './hosting-env.mjs';

const env = loadEnv('production', process.cwd(), 'VITE_');
const errors = validateHostingEnv(env);

if (errors.length > 0) {
  process.stderr.write([
    'Hosting env preflight FAILED.',
    ...errors.map(error => `- ${error}`),
    '沒有執行 production build；請先恢復本機 private env 設定。',
    '',
  ].join('\n'));
  process.exit(1);
}

process.stdout.write(
  `Hosting env preflight PASS：${REQUIRED_HOSTING_ENV.length} 個 Firebase production env 已存在；Emulator／App Check debug 模式未啟用。\n`
);
