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

- Dashboard 以 HKD 作第一階段基準幣別，顯示本月收入、支出、餘額、分類預算進度和支出提醒；其他 currency 保留原額分開列示，不會混加或作隱含匯率換算。
- 分析報表以 Recharts 顯示支出分類分佈、趨勢和分類變化。
- 月預算可按支出分類設定，供 Dashboard 和訂閱頁面計算使用。

### OCR、訂閱與目標

- 收據 OCR：登入後可上傳或拍攝收據圖片；前端經 `/api/ocr` backend proxy 呼叫 Cloud Function，再由後端以 Firebase Secret Manager 的 Gemini secret 解析金額、日期、分類和備註。使用者不需要、也不能輸入或傳送 Gemini API key。
- 訂閱管理：追蹤週期性支出、下一次付款日、試用結束日和提醒天數。
- 儲蓄目標採單一真相規則：未連帳戶時以 `deposits[]` ledger 為準；連結帳戶時以該帳戶的 `initialBalance + transfers` 為準。`savedAmount` 只保留為相容性 derived cache，不能直接編輯。舊目標只有 `savedAmount` 時會轉成確定性的期初存款記錄。

### 帳戶、安全與 PWA

- 帳戶與轉帳：管理現金、銀行、錢包和信用卡帳戶，並記錄帳戶間轉帳；`Account.currency` 是該帳戶的基準幣別，不同 currency 的交易會在寫入前被拒絕。
- Firebase Authentication：支援 Google 和 Email/Password 登入。
- Firestore：以登入使用者為單位儲存資料。
- App Check：可選擇啟用 reCAPTCHA v3 token 驗證以保護 OCR Function；後端啟用強制驗證後，沒有有效 token 的請求會被拒絕。
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
├─ .github/
│  ├─ workflows/ci.yml   # 非部署型 CI（typecheck/lint/test/build）
│  └─ dependabot.yml     # 自動依賴更新 PR
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

然後打開 `.env`，填入 Firebase Web App 設定；若要執行本機 OCR proxy，亦需填入供 `server.js` 在後端讀取的 `GEMINI_API_KEY`。`.env` 已被 `.gitignore` 排除，不應提交到 Git。

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

Production OCR 的 Gemini API key 只由 Cloud Function 使用 Firebase Secret Manager 讀取；不要把它放進 `VITE_` 前端環境變數、瀏覽器儲存空間或請求內容。部署 Functions 前，以有 Firebase project 權限的帳戶設定 secret：

```powershell
firebase functions:secrets:set GEMINI_API_KEY
```

輸入 secret 值後，再部署 Functions；前端只會透過 `/api/ocr` backend proxy 呼叫 OCR，不會接觸這個 key。

Cloud Function 也支援以下 OCR 每日配額設定；這些是本專案後端的預設限制，不是 Gemini 的免費額度或服務方案承諾。每日上限同時套用於每位登入使用者及全站，任何一項用完都會拒絕新的 OCR 請求：

| 變數 | 預設 | 說明 |
|---|---:|---|
| `OCR_DAILY_LIMIT_PER_USER` | 20 | 每位使用者每日 OCR 次數 |
| `OCR_DAILY_LIMIT_GLOBAL` | 50 | 全站每日 OCR 次數 |
| `REQUIRE_APP_CHECK` | `false` | 設為 `true` 時，OCR Function 會強制驗證 `X-Firebase-AppCheck` |
| `GEMINI_MODEL` | `gemini-3.6-flash` | OCR 主要使用的 Gemini model |
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

本機 OCR 開發有三種方式；三者都需要登入帳戶取得 Firebase ID token，且不能改為由使用者提供 Gemini key：

- 使用已部署的 Cloud Function：在 `.env` 設定 `VITE_OCR_PROXY_URL`。
- 使用 Firebase Hosting rewrite：部署後 production 會透過 `/api/ocr` 轉發到 Cloud Function。
- 使用 `npm run prototype` 啟動本地 backend proxy 時，`server.js` 會從未提交的 `.env` 讀取 `GEMINI_API_KEY`；key 仍不會送到瀏覽器。

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

純邏輯測試：

```powershell
npm run test
```

Watch 模式：

```powershell
npm run test:watch
```

Auth／Firestore emulator 整合測試（需要 Java 21 或以上）：

```powershell
npm run test:integration
```

整合測試會啟動本機 Firebase Authentication 與 Cloud Firestore emulator，使用 `demo-personal-finance-manager` 隔離專案，實際走 Web SDK、登入狀態、Security Rules、Firestore transaction／batch 與讀回驗證。目前覆蓋：

- 新增 Account 交易並建立／讀回對應 Transfer
- Dashboard 月度摘要只聚合指定基準幣別，不把 HKD 與 USD 相加
- 交易 currency 必須與所連結帳戶的基準幣別一致，失敗時不留下半筆交易
- Goal canonical ledger：舊 savedAmount 遷移、Account/Transfer 入金與扣款、刪除後餘額一致
- 訂閱到期自動入帳、日期推進及重跑去重
- 當月 Budget 同步寫入 `meta/budgets` 與 `budgetMonths/{month}`
- 完整 Backup Restore，包括取代、刪除缺席文件及資料指紋對拍

純邏輯 Vitest 仍不連外；整合測試只連本機 emulator，明確不會接觸 production Firebase。Cloud Functions、Gemini 與 OCR endpoint 的實際行為目前仍未納入自動整合測試。

一次跑完整本機檢查：

```powershell
npm run verify
```

`npm run verify` 會依序執行 typecheck、lint、純邏輯 Vitest、Auth／Firestore emulator 整合測試、前端 build 和 Functions build。

Vite build 可能會顯示 chunk size warning。這通常是效能提示，不代表 build 失敗；目前 app 已使用 route lazy loading，若要進一步優化，可再拆分 vendor chunks 或檢查大型依賴的載入時機。

### 持續整合（CI）

GitHub Actions（`.github/workflows/ci.yml`）會在 pull request 和 push 到 `main` 時以 Java 21 執行 `npm run verify`。CI 只啟動本機 emulator 做驗證，不會部署，也不使用任何 secret、token 或 API key。`main` 已啟用 branch protection，PR 需 `Verify` 檢查通過才可合併。

### 依賴維護（Dependabot）

Dependabot（`.github/dependabot.yml`）每週為根目錄 npm、`functions` npm 和 GitHub Actions 開更新 PR：minor/patch 會合併成一組以減少數量，major 則獨立開啟以便逐一審視。Repository 亦已啟用 Dependabot alerts 與 automated security fixes，會自動為已知漏洞開修正 PR。所有 Dependabot PR 同樣受 CI `Verify` 把關。

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

OCR Cloud Function 需要 Firebase ID token。請確認使用者已登入，前端才會把 token 放入 `Authorization: Bearer <token>`。如果後端已設定 `REQUIRE_APP_CHECK=true`，也要確認前端已設定有效的 App Check site key，並能送出 `X-Firebase-AppCheck` token。

### OCR 回傳 429

代表已達到後端設定的每日配額：每位使用者和全站配額會同時檢查，任一上限耗盡便不能再掃描，須待下一個每日週期或由維護者調整 Functions 設定。實際上限請以部署中的 `OCR_DAILY_LIMIT_PER_USER` 與 `OCR_DAILY_LIMIT_GLOBAL` 為準。

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
