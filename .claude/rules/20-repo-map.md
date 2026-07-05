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
| financeLogic.ts | 純邏輯。目標：`normalizeGoal`:22（讀取端 fallback 範本）、`getGoalSavedAmount`:36；日期：`getCurrentMonthKey`:53、`formatDateKey`:74、`addMonthsClamped`:85（月底夾住）；訂閱：`getNextSubscriptionBillingDate`:93、`getSubscriptionChargesForMonth`:104；預算：`calculateBudgetUsage`:142 |
| storage.ts | 全部 Firestore CRUD。**高危**：`processDueSubscriptions`:201（登入自動入帳，00-risks 風險 2）、`saveTransactionWithGoalLink`:95（runTransaction 連動目標）、`syncTransactionTransfer`:454（交易↔轉帳↔帳戶連動）。聚合：`getAccountBalance`:408、`getMonthlySummary`:515、`getCategoryBreakdown`:527 ⚠️（地雷 #2） |
| firebase.ts | 初始化。`getUid`:59（未登入直接 throw）、`clean`:66（JSON 往返去 undefined——**Firestore 寫入前必經**）；Firestore 開了 persistentLocalCache（離線快取） |
| ocr.ts | 前端打 `/api/ocr`（正式＝hosting rewrite→Cloud Run；本機＝vite proxy 或 VITE_OCR_PROXY_URL） |
| appearance.ts | localStorage 主題 `pfm-theme-mode` |
| secrets.ts | localStorage 使用者自備 Gemini key `fin_gemini_api_key`（**機密：勿印出、勿寫 log、勿放測試 fixture**） |
| authErrors.ts | Firebase Auth 錯誤碼 → 中文訊息 |

## 資料模型（Firestore：`users/{uid}/` 底下，兩位使用者各自一棵、互不可見）

- 集合：`transactions`、`subscriptions`、`goals`、`accounts`、`transfers`、`receipts`——文件 id＝物件 id，內容＝types/finance.ts 對應型別經 `clean()` 後原樣。
- 單文件：`meta/budgets`（`Record<分類, 金額>`，**只有一份、無月份歷史**）、`meta/events`（分析事件，保留最後 500 筆）。
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

- **金額**：JS number、單位「元」、2 位小數（不是整數 cents）。運算一律過 money.ts：加總用 `sumMoney(array)`，單一結果用 `roundMoney(x)`。✅ 正例：storage.ts:515 `getMonthlySummary`、financeLogic.ts `sumExpensesByCategory`。❌ 反例（仍存在於顯示層）：AnalysisScreen/DashboardScreen/SubscriptionsScreen 的分類 map 仍裸 `+` 累加（見 backlog 待辦）。storage 的 `getCategoryBreakdown` 已改用 `sumExpensesByCategory`。
- **日期**：`YYYY-MM-DD` 字串、**本地時區**（經 `formatDateKey`），比較直接用字串大小；月鍵 `YYYY-MM`。時間戳欄位（createdAt、at）才用 `toISOString()`。⚠️ 別混用：`toISOString().slice(0,10)` 是 UTC 日期，香港凌晨 0–8 點會差一天——ocr.ts:55 現存此問題（backlog #3）。
- **幣別**：欄位存在（currency，預設 'HKD'），但聚合層不分幣別直接加總（backlog #4）。兩人是否實務上單幣使用【UNVERIFIED，動多幣功能前先問 James】。
- **Firestore 寫入**：一律 `setDoc(ref, clean(obj))`；跨文件連動用 `runTransaction`（範本：saveTransactionWithGoalLink）。
- **新頁面**：lazy import + Suspense（照 App.tsx 現有模式）；樣式配 .module.css。
- **測試**：純邏輯放 `src/services/*.test.ts`（Vitest）；不寫連 Firebase 的測試（跑不了，見 00-risks 前提事實）。

## 已知地雷（動到附近先看這裡）

1. `processDueSubscriptions` 登入即跑、靜默吞錯、會寫帳（00-risks 風險 2）。
2. ~~`getCategoryBreakdown` 裸浮點加總~~ 已改用 `sumExpensesByCategory`（financeLogic.ts，有測試；分支 fix/category-breakdown-money 待併 main）；同型裸加總仍存在於 screens（見 backlog 待辦）。
3. ~~ocr.ts:55 `today` 用 UTC 日期~~ 已改用 `formatDateKey(new Date())`（分支 fix/ocr-utc-date 待併 main）。
4. 聚合不分幣別（見慣例）。
5. `meta/budgets` 無月份維度：改預算＝改「每個月」的預算；`loadBudgetRows` 只合成當月列。
6. Goal 有雙重真相：`savedAmount` 欄位 vs `deposits[]` 重算（`getGoalSavedAmount` 在有 deposits 時以重算為準）、又會被 `syncGoalSavedAmount` 用帳戶餘額覆寫——改目標邏輯前把這三處一起讀。
7. `clearSensitiveCache()` 是 no-op（storage.ts:509），別依賴它清資料。
8. PWA 更新要使用者手動按橫幅（00-risks 次要風險）。

## Backlog（依價值排序，上限 8 條；動手前仍要走專案 CLAUDE.md 硬規則）

已完成（2026-07-05，實作在各自分支、待 James 併入 main）：
- ✅ 資料備份／export：ProfileScreen `exportJsonBackup`/`exportCsv`，並補上 accounts＋transfers（feat/complete-json-backup）。
- ✅ getCategoryBreakdown 改用 sumMoney（拆成 financeLogic `sumExpensesByCategory`＋測試；fix/category-breakdown-money）。
- ✅ ocr.ts `today` 改用 `formatDateKey`（fix/ocr-utc-date）。

待辦（依價值排序）：
1. **screens 分類 map 仍裸浮點加總**：AnalysisScreen:55、DashboardScreen:100/104、SubscriptionsScreen:114/120——可共用 `sumExpensesByCategory`。
2. **資料還原／匯入（restore）**：讀備份 JSON 寫回 Firestore；高危（寫 production），須先問 James＋schema 相容設計。
3. 聚合分幣別或明文假設單幣（先問 James 實際使用）。
4. 10-prod-safety §8 的剩餘待驗證（Console rollback 步驟、export 是否需 Blaze）。

## Changelog
- 2026-07-05 建檔（Fable 5 建置 session）。
