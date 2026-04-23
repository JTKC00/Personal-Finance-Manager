import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',      // 確保輸出到 dist（Firebase Hosting 指向這裡）
    sourcemap: false,    // 正式版不需要 sourcemap，減少檔案大小
  },
});