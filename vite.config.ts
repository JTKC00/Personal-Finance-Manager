import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 本地開發：把 /api/ocr 轉發到 VITE_OCR_PROXY_URL（若有設定）
  // 若未設定，在 dev 環境下直接打 /api/ocr 會失敗；可搭配 Firebase emulator 或設 VITE_OCR_PROXY_URL
  const ocrTarget = env.VITE_OCR_PROXY_URL;

  return {
    plugins: [react()],
    build: {
      outDir: 'dist',      // 確保輸出到 dist（Firebase Hosting 指向這裡）
      sourcemap: false,    // 正式版不需要 sourcemap，減少檔案大小
    },
    ...(ocrTarget ? {
      server: {
        proxy: {
          '/api/ocr': {
            target: ocrTarget,
            changeOrigin: true,
            rewrite: () => new URL(ocrTarget).pathname,
          },
        },
      },
    } : {}),
  };
});