# 20 · Repo 地圖與慣例（金錢／日期／id）

> **本檔與程式碼衝突時，以程式碼為準，並當場更新本檔**（更新義務：30-judgment-addendum §R-P5）。行號是 2026-07-05 快照，會漂移，只當定位提示。
> 用法：先在這裡定位，再用 Read 的 offset/limit 精準讀；不要整檔吞大檔（00-risks §樣態 1）。

## 目錄職責

| 路徑 | 職責 |
|---|---|
| App.tsx | App shell：lazy 路由、AuthProvider、PWA 更新橫幅、**登入後自動跑訂閱入帳**（:54 附近） |
| src/screens/ | 8 個頁面（Dashboard／Analysis／Transaction／TransactionList／Goals／Subscriptions／Profile／Login），多數配對 .module.css（Subscriptions、TransactionList 兩頁沒有） |
| src/services/ | 所有邏輯與 IO（見下表）；唯一可以 import firebase 的層 |
| src/types/finance.ts | 全部資料型別的唯一定義（＝事實上的 schema） |
| src/components/ | 共用 UI（BottomNav 等） |
| src/constants/ | 收支分類清單、付款方式（歷史資料掛在這些字串上，改動要問 James——R-P3-d） |
| src/contexts/AuthContext.tsx | 登入狀態 |
| functions/src/index.ts | OCR Cloud Function（Gemini、每日 quota、App Check；建置 session 未深讀，動它前先自己讀一遍） |
| server.js | ⚠️ 早期 prototype，非正式後端，勿動勿模仿 |

## services/ 關鍵檔案

| 檔案 | 職責與關鍵函式（:行號≈） |
|---|---|
| money.ts | `roundMoney`:12、`sumMoney`:21——金額運算唯一合法途徑（整數 cents 防浮點漂移），純函式 |
| financeLogic.ts | 純邏輯。目標：`normalizeGoal`:22（讀取端 fallback 範本）、`getGoalSavedAmount`:36；分類聚合：`sumExpensesByCategory`:58、`sumSubscriptionChargesByCategory`:79（皆含測試——storage 與 screens 唯一合法的分類聚合）；日期：`getCurrentMonthKey`:94、`formatDateKey`:115、`addMonthsClamped`:126（月底夾住）；訂閱：`getNextSubscriptionBillingDate`:134、`getSubscriptionChargesForMonth`:145；預算：`calculateBudgetUsage`:183≈（screens 尚未採用，見 backlog 待辦 #4）；預算月份化（2026-07-13）：`buildBudgetRows`／`resolveBudgetMonth`／`compareBudgetToActual`（皆含測試） |
| storage.ts | 全部 Firestore CRUD。**高危**：`processDueSubscriptions`:201（登入自動入帳，00-risks 風險 2）、`saveTransactionWithGoalLink`:95（runTransaction 連動目標）、`syncTransactionTransfer`:454（交易↔轉帳↔帳戶連動）。聚合：`getAccountBalance`:408、`getMonthlySummary`:515、`getCategoryBreakdown`:528（已委派 financeLogic 的 `sumExpensesByCategory`）。預算（2026-07-13 起）：`loadBudgetMonth`／`saveCurrentMonthBudgets`（writeBatch 原子雙寫 legacy＋月文件）／`loadBudgetRowsForMonth`；`loadBudgetRows`＝當月委派，Dashboard/Subscriptions 零改動 |
| firebase.ts | 初始化。`getUid`:59（未登入直接 throw）、`clean`:66（JSON 往返去 undefined——**Firestore 寫入前必經**）；Firestore 開了 persistentLocalCache（離線快取） |
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

1. **寫入**：TransactionScreen → `saveTransactionWithGoalLink()`（若連結儲蓄目標：runTransaction 內同步改 goal.deposits）→ `syncTransactionTransfer()`（若選了帳戶：寫 `txn-*` 轉帳、重算相關目標）→ Firestore。
2. **讀取**：Dashboard／Analysis 用 `getTransactionsByMonth()`（date 字串範圍查詢）→ `getMonthlySummary()`／`getCategoryBreakdown()` 聚合。
3. **自動寫入**：登入後 App.tsx 觸發 `processDueSubscriptions()`——把到期訂閱寫成真交易、推進 nextBillingDate；錯誤在呼叫端 App.tsx 被靜默吞掉。
4. **帳戶餘額**：不存欄位，每次由 `initialBalance + 轉帳流入 − 轉帳流出` 重算（`getAccountBalance`）。

## 慣例（寫碼前先讀）

- **金額**：JS number、單位「元」、2 位小數（不是整數 cents）。運算一律過 money.ts：加總用 `sumMoney(array)`，單一結果用 `roundMoney(x)`；**分類聚合不要自寫 reduce**，直接用 financeLogic 的 `sumExpensesByCategory`／`sumSubscriptionChargesByCategory`。✅ 正例：storage.ts:528 `getCategoryBreakdown`、三個 screens 的分類聚合（2026-07-11 起）。❌ 反例（歷史，均已修復）：storage 裸加總（75cf3f9 修）、screens 分類 map 裸加總（2026-07-11 修）——同型新犯是本 repo 最常見的回歸。
- **日期**：`YYYY-MM-DD` 字串、**本地時區**（經 `formatDateKey`），比較直接用字串大小；月鍵 `YYYY-MM`。時間戳欄位（createdAt、at）才用 `toISOString()`。⚠️ 別混用：`toISOString().slice(0,10)` 是 UTC 日期，香港凌晨 0–8 點會差一天——ocr.ts 曾踩此坑，2026-07-05 已修（main 5c1bac2，見地雷 #3）。
- **幣別**：欄位存在（currency，預設 'HKD'），但聚合層不分幣別直接加總（backlog 待辦 #2）。兩人是否實務上單幣使用【UNVERIFIED——James 2026-07-11 答「不確定」；動多幣或跨幣統計前先跟他確認】。
- **Firestore 寫入**：一律 `setDoc(ref, clean(obj))`；跨文件連動用 `runTransaction`（範本：saveTransactionWithGoalLink）。
- **新頁面**：lazy import + Suspense（照 App.tsx 現有模式）；樣式配 .module.css。
- **測試**：純邏輯放 `src/services/*.test.ts`（Vitest）；不寫連 Firebase 的測試（跑不了，見 00-risks 前提事實）。

## 已知地雷（動到附近先看這裡）

1. `processDueSubscriptions` 登入即跑、靜默吞錯、會寫帳（00-risks 風險 2）。
2. ~~`getCategoryBreakdown` 與 screens 分類 map 的裸浮點加總~~ 已全數改用 financeLogic 聚合 helpers（storage 修於 75cf3f9；screens 修於 2026-07-11）。
3. ~~ocr.ts:55 `today` 用 UTC 日期~~ 已改用 `formatDateKey(new Date())`（已併 main 5c1bac2）。
4. 聚合不分幣別（見慣例）。
5. ~~`meta/budgets` 無月份維度~~ 2026-07-13 起有 `budgetMonths/{月}` 歷史（feat/monthly-budgets）。殘餘限制：某月從未按過「儲存預算」＝該月無歷史紀錄；另一裝置跑舊版寫 legacy 時，新版下次儲存才會把月文件補回同步。
6. Goal 有雙重真相：`savedAmount` 欄位 vs `deposits[]` 重算（`getGoalSavedAmount` 在有 deposits 時以重算為準）、又會被 `syncGoalSavedAmount` 用帳戶餘額覆寫——改目標邏輯前把這三處一起讀。
7. `clearSensitiveCache()` 是 no-op（storage.ts:509），別依賴它清資料。
8. PWA 更新要使用者手動按橫幅（00-risks 次要風險）。

## Backlog（依價值排序，上限 8 條；動手前仍要走專案 CLAUDE.md 硬規則）

已完成：
- ✅ 資料備份／export：ProfileScreen `exportJsonBackup`/`exportCsv`，並補上 accounts＋transfers（main f174ea2）。
- ✅ getCategoryBreakdown 改用 sumMoney（financeLogic `sumExpensesByCategory`＋測試；main 75cf3f9）。
- ✅ ocr.ts `today` 改用 `formatDateKey`（main 5c1bac2）。
- ✅ screens 分類 map 改用聚合 helpers、警示／預估加總過 roundMoney（分支 fix/screens-money-rounding，2026-07-11）。

待辦（依價值排序）：
1. **資料還原／匯入（restore）**：讀備份 JSON 寫回 Firestore；高危（寫 production），須先問 James＋schema 相容設計。
2. 聚合分幣別或明文假設單幣（先問 James 實際使用）。
3. **screens 的 today 用 UTC 日期**：DashboardScreen:78、SubscriptionsScreen:41 以 `toISOString().slice(0,10)` 當 today（同已修的 ocr.ts 地雷 #3；香港凌晨 0–8 點差一天，影響「即將扣款」與試用提醒判定）——改用 financeLogic `formatDateKey(new Date())`。屬行為修正（不是噪音清理），要走完整 R-P1。
4. screens 預算計算改用 financeLogic `calculateBudgetUsage`（現全 inline；屬重構，需行為對拍：Dashboard 警示門檻 0.75 vs 函式預設 0.7、ratio 有無 clamp）；順帶把 AnalysisScreen 日長條圖的裸加（barData，:113 附近，純顯示）一併收掉。
5. 10-prod-safety §8 的剩餘待驗證（Console rollback 步驟、export 是否需 Blaze）。

## Changelog
- 2026-07-05 建檔（Fable 5 建置 session）。
- 2026-07-05 與已完成工作同步：backlog #1–#3 標記完成、發現 screens 裸加總（Opus 接手 session）。
- 2026-07-08 Fable 覆核：三修已併 main（f174ea2／75cf3f9／5c1bac2）、清掉殘留舊引用（日期／幣別行、storage 表格）。
- 2026-07-11 backlog（舊）#1 完成：screens 聚合改 helpers；financeLogic 行號刷新；新增 UTC-today 與 calculateBudgetUsage 待辦。
- 2026-07-13 新增 backupReminder.ts（備份提醒，feat/backup-reminder）。
- 2026-07-13 預算月份化（feat/monthly-budgets）：新增 budgetMonths 集合＋原子雙寫、地雷 #5 劃掉、storage/financeLogic 表格更新。
