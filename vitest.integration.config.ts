import {defineConfig} from 'vitest/config';

export default defineConfig({
  define: {
    'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify('demo-api-key'),
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify('demo-personal-finance-manager.firebaseapp.com'),
    'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify('demo-personal-finance-manager'),
    'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': JSON.stringify('demo-personal-finance-manager.appspot.com'),
    'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify('000000000000'),
    'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify('1:000000000000:web:integration'),
    'import.meta.env.VITE_USE_FIREBASE_EMULATORS': JSON.stringify('true'),
  },
  test: {
    fileParallelism: false,
    include: ['src/integration/**/*.integration.ts'],
    maxWorkers: 1,
    testTimeout: 20000,
  },
});
