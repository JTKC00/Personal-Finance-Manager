import {afterEach, describe, expect, it} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const tempDirs: string[] = [];
const guardScript = resolve(process.cwd(), 'scripts/check-hosting-env.mjs');

function isolatedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_'))
  );
  return {...env, ...extra};
}

function completeEnv(): Record<string, string> {
  return {
    VITE_FIREBASE_API_KEY: 'test-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'example.invalid',
    VITE_FIREBASE_PROJECT_ID: 'test-project',
    VITE_FIREBASE_STORAGE_BUCKET: 'test-bucket',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '123456',
    VITE_FIREBASE_APP_ID: 'test-app-id',
  };
}

function runGuard(env: NodeJS.ProcessEnv) {
  const cwd = mkdtempSync(resolve(tmpdir(), 'pfm-hosting-env-'));
  tempDirs.push(cwd);
  return spawnSync(process.execPath, [guardScript], {
    cwd,
    env,
    encoding: 'utf8',
  });
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, {recursive: true, force: true});
});

describe('Hosting production env guard', () => {
  it('fails closed when a fresh checkout has no private Firebase env', () => {
    const result = runGuard(isolatedEnv());

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Hosting env preflight FAILED');
    expect(result.stderr).toContain('VITE_FIREBASE_API_KEY');
    expect(result.stderr).toContain('VITE_FIREBASE_APP_ID');
  });

  it('passes with all required Firebase production variables without printing values', () => {
    const env = completeEnv();
    env.VITE_FIREBASE_API_KEY = 'do-not-print-this-secret';
    const result = runGuard(isolatedEnv(env));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Hosting env preflight PASS');
    expect(result.stdout + result.stderr).not.toContain('do-not-print-this-secret');
  });

  it('rejects emulator mode for a production Hosting build', () => {
    const result = runGuard(isolatedEnv({
      ...completeEnv(),
      VITE_USE_FIREBASE_EMULATORS: 'true',
    }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('VITE_USE_FIREBASE_EMULATORS');
  });

  it('rejects App Check debug tokens from a production Hosting build', () => {
    const result = runGuard(isolatedEnv({
      ...completeEnv(),
      VITE_FIREBASE_APPCHECK_DEBUG_TOKEN: 'do-not-print-debug-token',
    }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('VITE_FIREBASE_APPCHECK_DEBUG_TOKEN');
    expect(result.stdout + result.stderr).not.toContain('do-not-print-debug-token');
  });
});
