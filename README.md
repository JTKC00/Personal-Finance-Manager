# Personal Finance Manager

一個以 React、Firebase 和 Cloud Functions 建立的個人理財 Web App。它支援收支紀錄、分類分析、儲蓄目標、訂閱管理、帳戶/轉帳管理，以及透過 Gemini OCR 從收據圖片擷取交易資料。

此 README 不包含正式部署網址、私人 Firebase project URL 或任何個人環境連結；部署後的網址請以 Firebase CLI 或 Firebase Console 顯示為準。

---

## 功能概覽

### 記帳與分類

- 新增、編輯、刪除、複製和搜尋收入/支出交易。
- 支援收入、支出分類篩選，交易列表會保留並顯示歷史交易中已存在的分類文字。
- 支出分類包含餐飲、交通、購物、娛樂、醫療、居住、金融支出、學習、禮物、旅遊、保險、家庭和其他。
- 收入分類包含薪資、獎金、投資、利息、副業、自由工作、生意收入、租金收入、退款、回贈、報銷、禮金、政府津貼和其他收入。

### 預算、分析與提醒

- Dashboard 顯示本月收入、支出、餘額、近期交易、分類預算進度和支出提醒。
- 分析報表以 Recharts 顯示支出分類分佈、趨勢和分類變化。
- 月預算可按支出分類設定，供 Dashboard 和訂閱頁面計算使用。

### OCR、訂閱與目標

- 收據 OCR：登入後可上傳或拍攝收據圖片，由 Cloud Function 呼叫 Gemini 解析金額、日期、分類和備註。
- 訂閱管理：追蹤週期性支出、下一次付款日、試用結束日和提醒天數。
- 儲蓄目標：建立目標、記錄存入/提取，並可連結支出交易。

### 帳戶、安全與 PWA

- 帳戶與轉帳：管理現金、銀行、錢包和信用卡帳戶，並記錄帳戶間轉帳。
- Firebase Authentication：支援 Google 和 Email/Password 登入。
- Firestore：以登入使用者為單位儲存資料。
- App Check：可選擇啟用 reCAPTCHA v3 token 驗證以保護 OCR Function。
- PWA：支援 manifest、service worker 和離線快取。

---

## 技術棧

| 類別 | 技術 |
|---|---|
| Frontend | React 19、TypeScript |
| Build | Vite 6 |
| Routing | React Router v6 |
| Styling | CSS Modules |
| Charts | Recharts |
| Icons | lucide-react |
| Backend | Firebase Cloud Functions v2 |
| Database | Cloud Firestore |
| Auth | Firebase Authentication |
| AI OCR | Google Gemini via Cloud Functions |
| Hosting | Firebase Hosting |
| Functions runtime | Node.js 22 |

---

## 專案結構

```text
Personal-Finance-Manager/
├─ src/
│  ├─ components/        # 共用 UI 元件
│  ├─ constants/         # 收入/支出分類和付款方式
│  ├─ contexts/          # AuthContext
│  ├─ screens/           # App 主要頁面
│  ├─ services/          # Firebase、OCR、Firestore、外觀設定等服務
│  ├─ types/             # TypeScript 型別
│  ├─ index.css
│  ├─ main.tsx
│  └─ theme.ts
├─ functions/
│  ├─ src/index.ts       # OCR Cloud Function
│  ├─ package.json
│  └─ tsconfig.json
├─ public/               # PWA icons 和 manifest
├─ DOC/                  # 維護教學 PDF/HTML
├─ App.tsx               # App shell、routing 和 PWA update banner
├─ firebase.json         # Hosting、rewrites、Functions predeploy
├─ firestore.rules
├─ vite.config.ts
├─ package.json
└─ README.md
```

---

## 必要條件

建議使用 Node.js 22，因為 Cloud Functions runtime 設定為 `nodejs22`。

```powershell
node --version
npm --version
git --version
```

需要安裝 Firebase CLI 並登入有 project 權限的帳戶：

```powershell
npm install -g firebase-tools
firebase login
firebase projects:list
```

---

## 本機設定

1. Clone 專案：

```powershell
git clone <repository-url>
cd Personal-Finance-Manager
```

2. 安裝根目錄依賴：

```powershell
npm install
```

3. 安裝 Functions 依賴：

```powershell
npm --prefix functions install
```

4. 建立本機環境變數：

```powershell
copy .env.example .env
```

然後打開 `.env`，填入 Firebase Web App 設定。`.env` 已被 `.gitignore` 排除，不應提交到 Git。

---

## 環境變數

前端使用 Vite，因此只有 `VITE_` 開頭的變數會進入 browser bundle。

| 變數 | 說明 |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase web app ID |
| `VITE_FIREBASE_MEASUREMENT_ID` | Firebase measurement ID，可選 |
| `VITE_OCR_PROXY_URL` | 本機開發時可指定 OCR proxy URL；production 主要使用 `/api/ocr` rewrite |
| `VITE_FIREBASE_APPCHECK_SITE_KEY` | Firebase App Check reCAPTCHA v3 site key，可選 |
| `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` | 本機 App Check debug token，可選；不要提交真實 token |

Functions OCR 使用 Firebase Secret Manager：

```powershell
firebase functions:secrets:set GEMINI_API_KEY
```

Cloud Function 也支援以下 quota 設定，未設定時會使用預設值：

| 變數 | 預設 | 說明 |
|---|---:|---|
| `OCR_DAILY_LIMIT_PER_USER` | 20 | 每位使用者每日 OCR 次數 |
| `OCR_DAILY_LIMIT_GLOBAL` | 50 | 全站每日 OCR 次數 |
| `REQUIRE_APP_CHECK` | `false` | 設為 `true` 時，OCR Function 會強制驗證 `X-Firebase-AppCheck` |
| `GEMINI_MODEL` | `gemini-3.5-flash` | OCR 主要使用的 Gemini model |
| `GEMINI_FALLBACK_MODELS` | `gemini-3.1-flash-lite,gemini-2.5-flash` | 主要 model 回 429/5xx 時依序 fallback 的 models |
| `GEMINI_MAX_ATTEMPTS_PER_MODEL` | 3 | 每個 model 對 transient failure 的重試次數 |

App Check 建議分兩步啟用：

1. 先在 Firebase Console 建立 Web App Check provider，將 site key 填入 `.env` 的 `VITE_FIREBASE_APPCHECK_SITE_KEY`，部署後觀察是否正常送出 token。
2. 確認正常後，再將 Functions 環境變數 `REQUIRE_APP_CHECK=true`，讓 OCR 後端強制拒絕沒有 App Check token 的請求。

---

## 本機開發

啟動 Vite：

```powershell
npm run dev
```

預設網址通常是：

```text
http://localhost:5173
```

本機 OCR 開發有兩種方式：

- 使用已部署的 Cloud Function：在 `.env` 設定 `VITE_OCR_PROXY_URL`。
- 使用 Firebase Hosting rewrite：部署後 production 會透過 `/api/ocr` 轉發到 Cloud Function。

---

## 檢查與 Build

前端 typecheck：

```powershell
npm run typecheck
```

前端 production build：

```powershell
npm run build
```

Functions build：

```powershell
npm --prefix functions run build
```

Lint：

```powershell
npm run lint
```

一次跑完整本機檢查：

```powershell
npm run verify
```

Vite build 可能會顯示 chunk size warning。這通常是效能提示，不代表 build 失敗；目前 app 已使用 route lazy loading，若要進一步優化，可再拆分 vendor chunks 或檢查大型依賴的載入時機。

---

## 部署

完整部署 Firestore rules、Functions 和 Hosting：

```powershell
firebase deploy
```

只部署 Hosting：

```powershell
firebase deploy --only hosting
```

只部署 Functions：

```powershell
firebase deploy --only functions
```

只部署 Firestore rules：

```powershell
firebase deploy --only firestore
```

部署成功後 Firebase CLI 會顯示 hosting URL；請不要把私人或正式部署網址提交到 README。

---

## 公司電腦 / 新電腦注意事項

如果 PowerShell 禁止執行 `npm.ps1` 或 `firebase.ps1`：

```powershell
npm.cmd run build
firebase.cmd deploy
```

如果 NVM 已安裝但 `node`、`npm` 或 `firebase` 找不到，可以只在目前 PowerShell 視窗暫時補 PATH，例如：

```powershell
$env:Path='C:\Users\<你的使用者>\AppData\Local\nvm\v22.x.x;C:\Users\<你的使用者>\AppData\Roaming\npm;' + $env:Path
```

這種做法只影響目前視窗，不會改 repo，也不會影響其他電腦。

更多完整步驟可參考：

- `DOC/web_app_maintenance_guide.pdf`
- `DOC/web_app_maintenance_guide.html`

---

## Git 與清理建議

開始工作前：

```powershell
git pull
git status
```

部署或 build 後再次檢查：

```powershell
git status
```

通常不應提交：

- `.env`
- `node_modules/`
- `functions/node_modules/`
- `dist/`
- `functions/lib/`
- `.firebase/`
- `firebase-debug.log`
- `typecheck_*.txt`

---

## 常見問題

### `firebase deploy` 說未登入

先登入：

```powershell
firebase login
```

再確認 project：

```powershell
firebase projects:list
```

### OCR 回傳 401

OCR Cloud Function 需要 Firebase ID token。請確認使用者已登入，前端才會把 token 放入 `Authorization: Bearer <token>`。

### OCR 回傳 429

代表達到每日 quota。預設每人每日 20 次，全站每日 50 次。

### 本機 build 可以，但 deploy 失敗

先分開測試：

```powershell
npm run build
npm --prefix functions run build
firebase deploy --only hosting
firebase deploy --only functions
```

這樣較容易分辨是前端、Functions、Firebase 權限，還是公司電腦環境問題。

---

## License

MIT
