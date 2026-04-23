# 個人財務管家 💰

一個為個人設計的記帳 Web App，支援收支記錄、財務分析、儲蓄目標追蹤，並可用 AI 掃描收據自動入帳。

🌐 **正式網址**：https://personal-finance-manager-8e8b4.web.app

---

## 功能特色

- **Dashboard** — 一覽本月收支概況、餘額及最近交易記錄
- **交易記錄** — 新增、分類、篩選收入與支出；支援 AI 掃描收據自動填寫金額與類別
- **財務分析** — 以圖表呈現每月支出分佈及趨勢
- **儲蓄目標** — 設定目標金額、追蹤進度、連結相關交易
- **個人資料** — 管理帳號設定及 Gemini API Key
- **Google / Email 登入** — 支援 Google 帳號及電郵密碼兩種登入方式
- **PWA 支援** — 可加入手機主畫面，像 App 一樣使用

---

## 技術架構

| 層次 | 技術 |
|---|---|
| 前端框架 | React 18 + TypeScript |
| 建構工具 | Vite 6 |
| 路由 | React Router v6 |
| 樣式 | CSS Modules |
| 後端/資料庫 | Firebase Firestore |
| 身份驗證 | Firebase Authentication（Google + Email/Password）|
| AI OCR | Google Gemini 3.1 Flash-Lite Preview（via Cloud Functions）|
| 部署 | Firebase Hosting + Cloud Functions（Node.js 22）|

---

## 專案結構

```
Personal-Finance-Manager/
├── src/
│   ├── components/        # 共用元件（BottomNav、Card、Screen）
│   ├── contexts/          # React Context（AuthContext）
│   ├── screens/           # 各頁面（Dashboard、Transaction、Analysis、Goals、Profile、Login）
│   ├── services/          # Firebase、OCR、Secrets 服務
│   ├── types/             # TypeScript 型別定義
│   └── constants/         # 常數（分類、顏色等）
├── functions/
│   └── src/
│       └── index.ts       # Cloud Function：OCR 掃描收據
├── public/
│   ├── manifest.json      # PWA Manifest
│   ├── icon-192.png
│   └── icon-512.png
├── App.tsx                # 路由設定
├── index.html             # HTML 入口
├── firebase.json          # Firebase 設定（Hosting + Firestore）
├── firestore.rules        # Firestore 安全規則
└── vite.config.ts         # Vite 設定
```

---

## 本地開發環境設定

### 先決條件

- [Node.js](https://nodejs.org) v22 或以上
- [Firebase CLI](https://firebase.google.com/docs/cli)：`npm install -g firebase-tools`
- Firebase 專案（已啟用 Firestore 及 Authentication）
- Google Gemini API Key（[取得連結](https://aistudio.google.com/apikey)）

### 安裝步驟

**第一步：Clone 專案**
```bash
git clone https://github.com/JTKC00/Personal-Finance-Manager.git
cd Personal-Finance-Manager
```

**第二步：安裝前端依賴**
```bash
npm install
```

**第三步：建立 `.env` 檔案**

複製範本並填入真實設定值：
```bash
cp .env.example .env
```

`.env` 內容：
```
VITE_FIREBASE_API_KEY=你的值
VITE_FIREBASE_AUTH_DOMAIN=你的專案.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=你的專案ID
VITE_FIREBASE_STORAGE_BUCKET=你的專案.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=你的值
VITE_FIREBASE_APP_ID=你的值
VITE_OCR_PROXY_URL=https://asia-east1-你的專案ID.cloudfunctions.net/ocr
```

> Firebase 設定值在 [Firebase Console](https://console.firebase.google.com) → 專案設定 → 你的應用程式 找到。

**第四步：啟動開發伺服器**
```bash
npm run dev
```

打開瀏覽器，前往 `http://localhost:5173`

---

## Firebase Cloud Functions 設定（OCR 功能）

**安裝 Functions 依賴**
```bash
cd functions
npm install
cd ..
```

**設定 Gemini API Key（需要 Blaze Plan）**
```bash
firebase functions:secrets:set GEMINI_API_KEY
```

**Deploy Functions**
```bash
firebase deploy --only functions
```

---

## 部署

**Build 前端**
```bash
npm run build
```

**Deploy 全部**
```bash
firebase deploy
```

**只 Deploy 前端**
```bash
firebase deploy --only hosting
```

**只 Deploy Functions**
```bash
firebase deploy --only functions
```

---

## 環境變數說明

| 變數名稱 | 說明 | 必填 |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase API Key | ✅ |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain | ✅ |
| `VITE_FIREBASE_PROJECT_ID` | Firebase 專案 ID | ✅ |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage Bucket | ✅ |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Messaging Sender ID | ✅ |
| `VITE_FIREBASE_APP_ID` | Firebase App ID | ✅ |
| `VITE_OCR_PROXY_URL` | Cloud Function OCR 端點 URL | OCR 功能需要 |

> ⚠️ `.env` 已加入 `.gitignore`，不會上傳到 GitHub，每台電腦需要獨立建立。

---

## 注意事項

- 本專案需要 Firebase **Blaze（付費）Plan** 才能使用 Cloud Functions 及 Secret Manager
- 個人使用量通常在免費額度內，不會產生實際費用
- Gemini API Key 由用戶自行在「個人資料」頁面輸入，儲存在瀏覽器 localStorage

---

## License

MIT
