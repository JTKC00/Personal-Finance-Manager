# 個人財務管家 💰

一個為個人設計的記帳 Web App，支援收支記錄、財務分析、儲蓄目標追蹤，並可用 AI 掃描收據自動入帳。

🌐 **正式網址**：https://personal.finance.manager.snugzap.com/

---

## 目錄

- [功能特色](#功能特色)
- [技術架構](#技術架構)
- [專案結構](#專案結構)
- [從零開始：建立 Firebase 專案](#從零開始建立-firebase-專案)
- [本地開發環境設定](#本地開發環境設定)
- [AI OCR 收據掃描設定](#ai-ocr-收據掃描設定)
- [部署到正式環境](#部署到正式環境)
- [環境變數說明](#環境變數說明)
- [常見問題排解](#常見問題排解)

---

## 功能特色

| 功能 | 說明 |
|---|---|
| **Dashboard** | 一覽本月收支概況、餘額、預算進度、儲蓄目標進度及最近交易記錄 |
| **收支記錄** | 新增、編輯、刪除收入與支出；可按月份切換瀏覽歷史記錄 |
| **AI 掃描收據** | 拍照或上傳收據圖片，Gemini AI 自動辨識金額、類別與日期 |
| **收據記錄** | 「我的帳戶」可瀏覽所有 OCR 掃描記錄，含成功/失敗狀態 |
| **財務分析** | 以圓餅圖和長條圖呈現每月支出分佈及每日趨勢，可切換月份 |
| **儲蓄目標** | 設定目標金額、手動入金/提款、查看入金歷史、連結相關交易 |
| **月預算設定** | 在「我的帳戶」為各支出分類設定月預算；Dashboard 顯示實際進度 |
| **CSV 匯出** | 一鍵匯出全部交易為 UTF-8 CSV，可用 Excel / Google Sheets 開啟 |
| **JSON 完整備份** | 在「我的帳戶」匯出交易、目標、預算和 OCR 記錄的完整備份 |
| **Google / Email 登入** | 支援 Google 帳號及電郵密碼兩種登入方式 |
| **忘記密碼** | 登入頁提供「忘記密碼？」流程，發送 Firebase 重設郵件 |
| **密碼強度要求** | 註冊時要求最少 8 位、含大寫、小寫英文字母及數字 |
| **綁定 Google 帳號** | 以電郵註冊的用戶可在「我的帳戶」綁定 Google，之後可雙向登入 |
| **PWA 支援** | 可加入手機主畫面，像原生 App 一樣使用；部署新版本後 App 自動顯示「有新版本，立即更新」通知 |

---

## 技術架構

| 層次 | 技術 |
|---|---|
| 前端框架 | React 19 + TypeScript |
| 建構工具 | Vite 6 |
| 路由 | React Router v6 |
| 樣式 | CSS Modules |
| 圖表 | Recharts |
| 資料庫 | Firebase Firestore（含離線持久化） |
| 身份驗證 | Firebase Authentication（Google + Email/Password）|
| AI OCR | Google Gemini 3.1 Flash-Lite Preview（via Cloud Functions v2）|
| 部署 | Firebase Hosting + Cloud Functions（Node.js 22）|

---

## 專案結構

```
Personal-Finance-Manager/
├── src/
│   ├── components/          # 共用 UI 元件
│   │   ├── BottomNav.tsx    # 底部導航列
│   │   ├── Card.tsx         # 通用卡片容器
│   │   └── Screen.tsx       # 頁面容器（含 loading/error 狀態）
│   ├── contexts/
│   │   └── AuthContext.tsx  # 登入狀態管理（useAuth hook）
│   ├── screens/             # 各頁面元件
│   │   ├── LoginScreen.tsx
│   │   ├── DashboardScreen.tsx
│   │   ├── TransactionScreen.tsx  # 含 AI 掃描收據功能
│   │   ├── AnalysisScreen.tsx
│   │   ├── GoalsScreen.tsx
│   │   └── ProfileScreen.tsx      # Gemini API Key 設定
│   ├── services/
│   │   ├── firebase.ts      # Firebase 初始化（app、auth、db）
│   │   ├── ocr.ts           # 呼叫 OCR Cloud Function
│   │   ├── secrets.ts       # Gemini API Key 的 localStorage 存取
│   │   └── storage.ts       # Firestore 資料存取（CRUD）
│   ├── types/
│   │   └── finance.ts       # 所有 TypeScript 型別定義
│   └── constants/
│       └── categories.ts    # 收支分類清單
├── functions/
│   └── src/
│       └── index.ts         # Cloud Function：OCR 掃描收據（呼叫 Gemini API）
├── public/
│   └── manifest.json        # PWA Manifest
├── App.tsx                  # 路由設定（受保護路由 + 公開路由）
├── firebase.json            # Firebase Hosting + Functions 設定
├── firestore.rules          # Firestore 安全規則（每個用戶只能存取自己的資料）
└── vite.config.ts           # Vite 設定（含開發時 OCR 代理）
```

---

## 從零開始：建立 Firebase 專案

> 如果你已有 Firebase 專案可以跳過此節。

**第一步：建立 Firebase 專案**

1. 前往 [Firebase Console](https://console.firebase.google.com)，點擊「新增專案」
2. 輸入專案名稱，依照提示完成建立

**第二步：啟用 Firestore 資料庫**

1. 在 Firebase Console 左側選單點擊「Firestore Database」
2. 點擊「建立資料庫」
3. 選擇「以正式版模式啟動」（安全規則會由本專案的 `firestore.rules` 管理）
4. 選擇離你最近的資料中心位置

**第三步：啟用身份驗證**

1. 在左側選單點擊「Authentication」→「開始使用」
2. 點擊「Sign-in method」分頁
3. 啟用「**電子郵件/密碼**」
4. 啟用「**Google**」，填入專案的支援電子郵件後儲存

**第四步：新增 Web 應用程式，取得設定值**

1. 在專案總覽頁點擊「`</>`」圖示，新增 Web 應用程式
2. 填入應用程式暱稱後，點擊「註冊應用程式」
3. 複製 `firebaseConfig` 物件內的所有值，稍後會填入 `.env` 檔案

**第五步：升級至 Blaze（Pay-as-you-go）方案**

> ⚠️ 使用 Cloud Functions 必須升級至 Blaze 方案。個人使用量通常在免費額度內，不會實際收費。

在 Firebase Console 左下角點擊「升級」，依步驟設定付款方式。

---

## 本地開發環境設定

### 先決條件

- [Node.js](https://nodejs.org) **v22 或以上**（`node -v` 確認）
- [Firebase CLI](https://firebase.google.com/docs/cli)：執行 `npm install -g firebase-tools` 安裝

### 安裝步驟

**第一步：Clone 專案並安裝前端依賴**

```bash
git clone https://github.com/JTKC00/Personal-Finance-Manager.git
cd Personal-Finance-Manager
npm install
```

**第二步：安裝 Cloud Functions 依賴**

```bash
cd functions && npm install && cd ..
```

**第三步：登入 Firebase CLI 並連結專案**

```bash
firebase login
firebase use --add
```

執行 `firebase use --add` 後，從列表選擇你的 Firebase 專案，並設定別名（例如 `default`）。

**第四步：建立 `.env` 設定檔**

在專案根目錄建立 `.env` 檔案（注意：此檔案已在 `.gitignore` 中，不會被上傳）：

```bash
touch .env
```

填入以下內容，將所有「`你的值`」替換成 [第四步](#第四步新增-web-應用程式取得設定值) 取得的 Firebase 設定值：

```env
VITE_FIREBASE_API_KEY=你的值
VITE_FIREBASE_AUTH_DOMAIN=你的專案ID.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=你的專案ID
VITE_FIREBASE_STORAGE_BUCKET=你的專案ID.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=你的值
VITE_FIREBASE_APP_ID=你的值
```

**第五步：啟動開發伺服器**

```bash
npm run dev
```

打開瀏覽器，前往 `http://localhost:5173`。

> **注意**：在本地開發環境中，AI 掃描收據功能預設無法使用（因為 `/api/ocr` 路由只在部署後由 Firebase Hosting 轉發）。如需在本地測試 OCR，請參考下方的 [本地測試 OCR](#本地測試-ocr（選用）) 說明。

---

## AI OCR 收據掃描設定

OCR 功能透過 Firebase Cloud Function 呼叫 Google Gemini API 來辨識收據。

### Gemini API Key 的兩種使用方式

本專案支援兩種方式提供 Gemini API Key，**擇一即可**：

| 方式 | 適合對象 | 說明 |
|---|---|---|
| **方式 A：後端 Secret**（推薦） | 自己架設給他人使用 | Key 存在 Cloud Secret Manager，用戶看不到 Key |
| **方式 B：用戶自帶 Key** | 個人使用 | 用戶在 App「我的帳戶」頁輸入自己的 Key，存在瀏覽器 |

App 呼叫時會優先使用用戶自帶的 Key；若用戶未設定，則使用後端 Secret。

### 方式 A：設定後端 Secret

**1. 取得 Gemini API Key**

前往 [Google AI Studio](https://aistudio.google.com/apikey) 建立 API Key。

**2. 將 Key 存入 Cloud Secret Manager**

```bash
firebase functions:secrets:set GEMINI_API_KEY
```

系統會提示輸入 Key 值，貼上後按 Enter。

**3. 部署 Cloud Function**

```bash
firebase deploy --only functions
```

**4. 部署 Firebase Hosting（讓 `/api/ocr` 路由生效）**

```bash
firebase deploy --only hosting
```

部署完成後，App 內的「掃描收據」功能即可使用。

### 方式 B：用戶自帶 Key

只需完成上方的 Function 和 Hosting 部署步驟，然後：

1. 前往 App「我的帳戶」→「Gemini API Key」
2. 輸入你自己的 Gemini API Key 並儲存
3. 之後使用「掃描收據」功能時，App 會自動使用此 Key

### 本地測試 OCR（選用）

若需要在本地開發環境測試 OCR 功能，先完成上方的 Function 部署，找到函式 URL（格式為 `https://ocr-xxxxxxxx-uc.a.run.app`），然後在 `.env` 加入：

```env
VITE_OCR_PROXY_URL=https://ocr-xxxxxxxx-uc.a.run.app
```

Vite 開發伺服器會自動將 `/api/ocr` 請求代理到此 URL。

> 函式 URL 可在 `firebase deploy --only functions` 輸出結果的最後一行找到，或在 [Firebase Console](https://console.firebase.google.com) → Functions 頁面查看。

---

## 部署到正式環境

**部署前檢查**

```bash
npm run lint
npm run typecheck
npm run build
```

**一次部署全部（Hosting + Functions + Firestore Rules）**

```bash
firebase deploy
```

**單獨部署各部分**

```bash
# 只部署前端
firebase deploy --only hosting

# 只部署 Cloud Functions
firebase deploy --only functions

# 只部署 Firestore 安全規則
firebase deploy --only firestore:rules
```

### 提升忘記密碼郵件送達率

Firebase Authentication 預設會代發忘記密碼郵件。正式環境建議使用自己的網域作為 Auth email domain，讓用戶看到的寄件者和重設連結都更一致。

**設定步驟**

1. 前往 Firebase Console → Authentication → Templates。
2. 編輯 Password reset template。
3. 點擊「customize domain」，輸入正式網域，例如 `personal.finance.manager.snugzap.com` 或專用子網域。
4. 按 Firebase 顯示的 DNS records 到你的網域供應商新增紀錄。
5. 等待 DNS 驗證通過後，再發送測試重設郵件。

**DNS 與信任檢查清單**

- Firebase 要求的網域驗證 DNS records 已全部加入並通過驗證。
- 若同一網域也由 Google Workspace、SendGrid、Mailgun、Postmark 等服務寄信，確認 SPF 不互相衝突。
- 為主要寄信網域設定 DKIM。
- 設定 DMARC，初期可使用 `p=none` 觀察，再逐步收緊政策。
- 忘記密碼郵件主旨和內容保持簡短，避免大量連結或促銷字眼。

---

## 環境變數說明

所有以 `VITE_` 開頭的變數需要建立在根目錄的 `.env` 檔案中。

| 變數名稱 | 說明 | 必填 |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Web API Key | ✅ |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain（`專案ID.firebaseapp.com`）| ✅ |
| `VITE_FIREBASE_PROJECT_ID` | Firebase 專案 ID | ✅ |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage Bucket | ✅ |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Cloud Messaging Sender ID | ✅ |
| `VITE_FIREBASE_APP_ID` | Firebase Web App ID | ✅ |
| `VITE_OCR_PROXY_URL` | Cloud Function OCR 的完整 URL（僅本地開發測試 OCR 時需要）| ❌ |

> ⚠️ `.env` 已加入 `.gitignore`，絕對不會上傳到 GitHub。**切勿將真實 Key 直接寫死在程式碼中。**

---

## 常見問題排解

**Q：登入時出現「auth/unauthorized-domain」錯誤**

本地開發時的 `localhost` 網域需要加入 Firebase 授權清單。
前往 Firebase Console → Authentication → Settings → 授權網域，新增 `localhost`。

**Q：忘記密碼後無法登入**

在登入頁輸入電郵後，點擊密碼欄下方的「忘記密碼？」連結，系統會發送重設郵件。
收不到郵件時請檢查垃圾郵件信箱；正式環境建議完成上方的 Auth email custom domain 和 DNS 設定。

**Q：以電郵註冊後想改用 Google 登入**

在 App「我的帳戶」→「帳號」區塊，點擊「綁定 Google 帳號」，完成後可同時使用兩種方式登入，資料完全共享。

**Q：手機 PWA 未更新到最新版本**

App 有新版本時會自動在頂部顯示「🎉 App 有新版本！」橫幅，點「立即更新」即可。
若沒看到橫幅，請嘗試關閉所有分頁再重新開啟；或在瀏覽器設定中清除該網站的快取資料後重新進入。

**Q：掃描收據後出現「請先到『我的帳戶』輸入 Gemini API Key 後再試」**

表示後端的 Secret 未設定或失效，且用戶也未輸入自帶的 Key。
- 確認已執行 `firebase functions:secrets:set GEMINI_API_KEY` 並填入有效的 Key
- 或在 App「我的帳戶」頁輸入有效的 Gemini API Key

**Q：掃描收據出現「OCR 服務連線失敗」**

確認 Firebase Hosting 已部署最新版本（`firebase deploy --only hosting`）。
Hosting 的 rewrite 規則負責將 `/api/ocr` 轉發到 Cloud Function；若 Hosting 未部署，路由不會生效。

**Q：`firebase deploy` 失敗，提示需要 Blaze Plan**

Cloud Functions 需要 Blaze（Pay-as-you-go）方案。前往 Firebase Console 左下角升級，個人使用量通常在免費額度內不會收費。

**Q：Firestore 讀寫出現 Permission Denied**

確認 Firestore 安全規則已部署，且用戶已登入。
執行 `firebase deploy --only firestore:rules` 重新部署規則。

---

## License

MIT

## 聯絡資訊

如有問題或建議，請聯絡：

James Tong
Email: kachuntong01@gmail.com
