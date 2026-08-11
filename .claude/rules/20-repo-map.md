# 20 · Repo 地圖與慣例（金錢／日期／id）

> **本檔與程式碼衝突時，以程式碼為準，並當場更新本檔**（更新義務：30-judgment-addendum §R-P5）。行號是 2026-07-05 快照，會漂移，只當定位提示。
> 用法：先在這裡定位，再用 Read 的 offset/limit 精準讀；不要整檔吞大檔（00-risks §樣態 1）。

## 目錄職責

| 路徑 | 職責 |
|---|---|
| App.tsx | App shell：lazy 路由、AuthProvider、SubscriptionProcessingProvider、PWA 更新橫幅；登入後由訂閱處理 context 自動入帳 |
| src/screens/ | 8 個頁面（Dashboard／Analysis／Transaction／TransactionList／Goals／Subscriptions／Profile／Login），多數配對 .module.css（Subscriptions、TransactionList 兩頁沒有） |
| src/integration/ | Auth／Firestore Emulator 整合測試（交易＋Account/Transfer、訂閱、月度 Budget、Backup Restore、跨使用者 rules） |
| src/services/ | 所有邏輯與 IO（見下表）；唯一可以 import firebase 的層 |
| src/types/finance.ts | 全部資料型別的唯一定義（＝事實上的 schema） |
| src/components/ | 共用 UI（BottomNav 等） |
| src/constants/ | 收支分類清單、付款方式（歷史資料掛在這些字串上，改動要問 James——R-P3-d） |
| src/contexts/ | `AuthContext` 管登入狀態；`SubscriptionProcessingContext` 管登入後自動入帳、錯誤狀態與安全重試 |
| scripts/test-firebase-integration.sh | 以 Java 21 啟動本機 Firebase Emulator 並跑整合測試 |
| vitest.integration.config.ts | 整合測試專用 Vitest 設定；固定使用 `demo-personal-finance-manager`，禁止指向 production |
| functions/src/index.ts | OCR Cloud Function（ID token、Gemini、每日 quota、App Check observe／enforce） |
| functions/src/ocrContract.ts | OCR schema v3、香港付款 evidence、prompt、runtime validation |
| functions/src/geminiClient.ts | Gemini REST request、transient retry 與 model fallback；不得記錄 payload |
| functions/src/appCheckPolicy.ts | App Check 純 policy：`false` observe 不阻擋、`true` enforce 拒絕 missing／invalid；配對 Node tests |
| server.js | ⚠️ 早期 prototype，非正式後端，勿動勿模仿 |

## services/ 關鍵檔案

| 檔案 | 職責與關鍵函式（:行號≈） |
|---|---|
| money.ts | `roundMoney`:12、`sumMoney`:21——金額運算唯一合法途徑（整數 cents 防浮點漂移），純函式 |
| financeLogic.ts | 純邏輯。目標：`normalizeGoal`（legacy opening entry）、`getGoalSavedAmount`（standalone ledger）、`getGoalWithSavedAmount`（canonical resolver）、`calculateAccountBalance`（linked ledger）；分類聚合：`sumExpensesByCategory`、`sumSubscriptionChargesByCategory`；幣別：`normalizeCurrency`、`summarizeTransactionsByCurrency`；日期、訂閱與預算 helpers |
| storage.ts | 全部 Firestore CRUD。**高危**：`processDueSubscriptions`（登入自動入帳，00-risks 風險 2）、`saveTransactionWithGoalLink`（runTransaction 連動目標）、`syncTransactionTransfer`（交易↔轉帳↔帳戶連動）、`restoreFinanceBackup`（完整取代資料）。聚合：`getAccountBalance`、`getMonthlySummary`、`getCategoryBreakdown`。預算：`loadBudgetMonth`／`saveCurrentMonthBudgets`（writeBatch 原子雙寫 legacy＋月文件）／`loadBudgetRowsForMonth`。備份：`createFinanceBackup`／`restoreFinanceBackup` |
| firebase.ts | 初始化。正式環境用 persistentLocalCache；只有 `VITE_USE_FIREBASE_EMULATORS=true` 才改用 memory cache 並連 Auth／Firestore Emulator。`getUid` 未登入直接 throw；`clean` 去 undefined，Firestore 寫入前必經 |
| financeBackup.ts | 完整備份 schema 驗證、項目計數、差異預覽與資料指紋（純邏輯） |
| subscriptionProcessing.ts | 包裝自動入帳的錯誤保存與重試狀態；React context 使用這個狀態機 |
| ocr.ts | 前端打 `/api/ocr`（正式＝hosting rewrite→Cloud Run；本機＝vite proxy 或 VITE_OCR_PROXY_URL） |
| appearance.ts | localStorage 主題 `pfm-theme-mode` |
| backupReminder.ts | localStorage 備份提醒 `pfm-last-backup-at`（>30 天沒匯出完整 JSON 備份 → Dashboard 提醒卡＋Profile 狀態行；純邏輯含測試） |
| secrets.ts | localStorage 使用者自備 Gemini key `fin_gemini_api_key`（**機密：勿印出、勿寫 log、勿放測試 fixture**） |
| authErrors.ts | Firebase Auth 錯誤碼 → 中文訊息 |

## 資料模型（Firestore：`users/{uid}/` 底下，兩位使用者各自一棵、互不可見）

- 集合：`transactions`、`subscriptions`、`goals`、`accounts`、`transfers`、`receipts`——文件 id＝物件 id，內容＝types/finance.ts 對應型別經 `clean()` 後原樣。
- 單文件：`meta/budgets`（`Record<分類, 金額>`——**legacy，儲存預算時與月度文件原子雙寫保持同步**）、`meta/events`（分析事件，保留最後 500 筆）。
- 月度預算集合：`budgetMonths/{YYYY-MM}`（2026-07-13 起；文件＝`Record<分類, 金額>`。**當月一律讀 legacy**（兩版 app 都寫它，不會跨裝置過期）；其他月讀該月自己的文件、缺文件＝該月無紀錄。舊版 app 只讀寫 legacy 也不壞）。
- **id／去重鍵格式＝schema 的一部分，改了＝資料相容性破壞**（00-risks 風險 1）：
  - 訂閱入帳交易 id：`sub-{訂閱id}-{日期}`；去重鍵 `{subscriptionId}:{date}`
  - 交易連動轉帳 id：`txn-{交易id}`
  - 目標 entry id：`{goalId}-{timestamp}-{隨機}`

## 一筆交易的資料流（讀懂這段就懂一半）

1. **寫入**：TransactionScreen → `saveTransactionWithGoalLink()`。standalone goal 在 runTransaction 內寫 `deposits[]`；account-linked goal 則把目標扣款寫成 `txn-*` Transfer，Goal 餘額由帳戶 ledger 推導。一般帳戶交易仍可經 `syncTransactionTransfer()` 建立對應 Transfer。
2. **讀取**：Dashboard／Analysis 用 `getTransactionsByMonth()`（date 字串範圍查詢）→ `getMonthlySummary()`／`getCategoryBreakdown()` 聚合。
3. **自動寫入**：登入後 `SubscriptionProcessingProvider` 觸發 `processDueSubscriptions()`——把到期訂閱寫成真交易、推進 nextBillingDate；失敗不阻斷登入，但 Dashboard 顯示警示、保留原因並提供重試。
4. **帳戶餘額**：不存欄位，每次由 `initialBalance + 轉帳流入 − 轉帳流出` 重算（`getAccountBalance`）。

## 慣例（寫碼前先讀）

- **金額**：JS number、單位「元」、2 位小數（不是整數 cents）。運算一律過 money.ts：加總用 `sumMoney(array)`，單一結果用 `roundMoney(x)`；**分類聚合不要自寫 reduce**，直接用 financeLogic 的 `sumExpensesByCategory`／`sumSubscriptionChargesByCategory`。✅ 正例：storage.ts:528 `getCategoryBreakdown`、三個 screens 的分類聚合（2026-07-11 起）。❌ 反例（歷史，均已修復）：storage 裸加總（75cf3f9 修）、screens 分類 map 裸加總（2026-07-11 修）——同型新犯是本 repo 最常見的回歸。
- **日期**：`YYYY-MM-DD` 字串、**本地時區**（經 `formatDateKey`），比較直接用字串大小；月鍵 `YYYY-MM`。時間戳欄位（createdAt、at）才用 `toISOString()`。⚠️ 別混用：`toISOString().slice(0,10)` 是 UTC 日期，香港凌晨 0–8 點會差一天——ocr.ts 曾踩此坑，2026-07-05 已修（main 5c1bac2，見地雷 #3）。
- **幣別**：`Account.currency` 是帳戶基準幣別，連結交易必須相同，否則在 `saveTransactionWithGoalLink` 寫入前拒絕。第一階段不做 FX；Dashboard 固定以 HKD 為顯示基準，月度摘要、預算、訂閱預留、分類警示及異常消費只計 HKD，其他 currency 原額分列。`summarizeTransactionsByCurrency` 是分幣別聚合範本。Analysis 等畫面仍可能混加，見 backlog。
- **Firestore 寫入**：一律 `setDoc(ref, clean(obj))`；跨文件連動用 `runTransaction`（範本：saveTransactionWithGoalLink）。
- **Goal canonical source**：無 `accountId`＝`deposits[]`；有 `accountId`＝Account `initialBalance + transfers`。`savedAmount` 僅是 derived cache，不可直接編輯或單獨加減。linked goal 的畫面歷史由 `goalId` Transfer 投影，原始 Transfer 才是真相。
- **新頁面**：lazy import + Suspense（照 App.tsx 現有模式）；樣式配 .module.css。
- **測試**：純邏輯放 `src/services/*.test.ts`；Auth／Firestore 流程放 `src/integration/*.integration.ts`；Functions policy 用 Node test。`npm run verify` 全部會跑；Live Gemini 由 `functions/src/ocrEval.ts` 使用私有測試集明確執行，不進 CI。

## 已知地雷（動到附近先看這裡）

1. `processDueSubscriptions` 登入即跑且會寫帳；錯誤已有 Dashboard 警示與安全重試，但修改時仍須維持 deterministic id 去重（00-risks 風險 2）。
2. ~~`getCategoryBreakdown` 與 screens 分類 map 的裸浮點加總~~ 已全數改用 financeLogic 聚合 helpers（storage 修於 75cf3f9；screens 修於 2026-07-11）。
3. ~~ocr.ts:55 `today` 用 UTC 日期~~ 已改用 `formatDateKey(new Date())`（已併 main 5c1bac2）。
4. Analysis／Subscriptions 等非 Dashboard 聚合仍未全面分幣別（見慣例與 backlog）。
5. ~~`meta/budgets` 無月份維度~~ 2026-07-13 起有 `budgetMonths/{月}` 歷史（feat/monthly-budgets）。殘餘限制：某月從未按過「儲存預算」＝該月無歷史紀錄；另一裝置跑舊版寫 legacy 時，新版下次儲存才會把月文件補回同步。
6. ~~Goal 的 `savedAmount`／`deposits[]`／帳戶餘額三重真相~~ 2026-08-07 已收斂 canonical resolver。殘餘相容限制：欄位 `savedAmount` 仍存在供舊版 app 使用，但新版讀取永遠由 deposits 或 Account/Transfer 重算；改 Goal 時不得重新把 cache 當輸入。
7. `clearSensitiveCache()` 是 no-op（storage.ts:509），別依賴它清資料。
8. PWA 更新要使用者手動按橫幅（00-risks 次要風險）。

## Backlog（依價值排序，上限 8 條；動手前仍要走專案 CLAUDE.md 硬規則）

已完成：
- ✅ 資料備份／export：ProfileScreen `exportJsonBackup`/`exportCsv`，並補上 accounts＋transfers（main f174ea2）。
- ✅ getCategoryBreakdown 改用 sumMoney（financeLogic `sumExpensesByCategory`＋測試；main 75cf3f9）。
- ✅ ocr.ts `today` 改用 `formatDateKey`（main 5c1bac2）。
- ✅ screens 分類 map 改用聚合 helpers、警示／預估加總過 roundMoney（分支 fix/screens-money-rounding，2026-07-11）。
- ✅ Dashboard／Subscriptions 的 today 統一改用本地時區 `formatDateKey(new Date())`（2026-08-07）。
- ✅ 訂閱自動入帳失敗不阻斷登入；Dashboard 顯示原因並可安全重試（2026-08-07）。
- ✅ 完整 Backup Restore：schema 驗證、日期／項目數、差異預覽、自動下載現況備份後完整取代（2026-08-07）。
- ✅ Auth／Firestore Emulator 整合測試：交易＋Account/Transfer、訂閱自動入帳、月度 Budget、Backup Restore 與跨使用者 rules（2026-08-07）。
- ✅ Dashboard 第一階段基準幣別：HKD 聚合，其他 currency 分列且不作 FX（2026-08-07）。
- ✅ Goal canonical source：standalone deposits ledger、linked Account/Transfer ledger；savedAmount 僅 derived cache（2026-08-07）。

待辦（依價值排序）：
1. Analysis／Subscriptions 等非 Dashboard 聚合全面按 currency 隔離；仍不做 FX。
2. screens 預算計算改用 financeLogic `calculateBudgetUsage`（現全 inline；屬重構，需行為對拍：Dashboard 警示門檻 0.75 vs 函式預設 0.7、ratio 有無 clamp）；順帶把 AnalysisScreen 日長條圖的裸加（barData，:113 附近，純顯示）一併收掉。
3. OCR endpoint／App Check 實際 token 尚須 deployment 驗證；Gemini 準確度改由私有香港收據 baseline 評估，不在 CI 讀取真實圖片或 secret。
4. 10-prod-safety §8 的剩餘待驗證（Console rollback 步驟、export 是否需 Blaze）。

## Changelog
- 2026-07-05 建檔（Fable 5 建置 session）。
- 2026-07-05 與已完成工作同步：backlog #1–#3 標記完成、發現 screens 裸加總（Opus 接手 session）。
- 2026-07-08 Fable 覆核：三修已併 main（f174ea2／75cf3f9／5c1bac2）、清掉殘留舊引用（日期／幣別行、storage 表格）。
- 2026-07-11 backlog（舊）#1 完成：screens 聚合改 helpers；financeLogic 行號刷新；新增 UTC-today 與 calculateBudgetUsage 待辦。
- 2026-07-13 新增 backupReminder.ts（備份提醒，feat/backup-reminder）。
- 2026-07-13 預算月份化（feat/monthly-budgets）：新增 budgetMonths 集合＋原子雙寫、地雷 #5 劃掉、storage/financeLogic 表格更新。
- 2026-08-07 同步本地日期、訂閱錯誤／重試、完整 Restore 與 Auth／Firestore Emulator 整合測試現況。
- 2026-08-07 Dashboard 固定 HKD 基準幣別，其他 currency 分列；新增分幣別聚合慣例及其餘畫面待辦。
- 2026-08-07 Goal 雙重真相收斂：新增 legacy opening migration、account ledger resolver 與 Transfer-based linked goal history。
- 2026-08-10 App Check 加入 observe logging／response status、typed boolean parameter、enforce policy tests 與兩階段 rollout gate。
