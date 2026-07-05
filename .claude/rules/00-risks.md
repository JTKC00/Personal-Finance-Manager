# 00 · 專案風險診斷（2026-07-05，Fable 5 建置 session 所寫）

> 讀者：在本 repo 工作的任何模型。這份是背景診斷，後面各規則檔都引用它；日常 session 不用全讀，路由到哪讀哪。
> 證據標記：【實測】= 建置 session 直接從程式碼確認；【James】= 使用者 2026-07-05 親口確認；【UNVERIFIED】= 未能查證。

## 前提事實

- 本 app 已上線，James 與一位好友日常使用，資料是兩人的真實財務紀錄。【James】
- 資料唯一存放處是 Firestore（`users/{uid}/...`，每人一棵子樹，互相隔離）；**目前沒有任何備份或 export 機制**。【James 確認「沒有／不確定」】
- 部署純手動（`firebase deploy`，James 執行）；CI 只驗證不部署；線上版本 2026-07-05 時＝最新 main。【James】
- 測試（Vitest）只覆蓋純邏輯（money、financeLogic、authErrors、appearance、secrets），**完全不碰 Firestore、Auth、Functions**。【實測：src/services/*.test.ts 清單＋README】

## 最容易把線上弄壞的前三名

### 1. 資料相容性破壞（schema drift）——後果最重
Firestore 沒有 schema 驗證，`src/types/finance.ts` 是唯一的格式定義。危險不只欄位名：
- **id 格式也是 schema**：訂閱自動入帳靠交易 id `sub-{訂閱id}-{日期}` 與 `{subscriptionId}:{date}` 鍵去重（storage.ts `processDueSubscriptions`）；交易連動轉帳靠 `txn-{交易id}`。改這些格式＝舊資料的去重／連動全部失效→**重複入帳或連動斷裂**。
- 改欄位名／型別／語意 → 舊文件讀出 `undefined` → 金額變 `NaN`、畫面壞、統計錯。
- 兩台裝置（James＋朋友）因 PWA 更新需手動確認，**新舊版本會並存一段時間**，同時讀寫同一份資料。
**預防**：只加可選欄位、不改不刪既有欄位；讀取端寫 fallback（範本：financeLogic.ts `normalizeGoal`）；動 schema 前必讀 `.claude/rules/10-prod-safety.md` §3 並問 James。
**救援**：Firestore 裡的舊資料不會因前端改版消失；回滾前端到舊版即可恢復讀寫（見 10-prod-safety §6）。但「新版已寫入的新格式資料」舊版讀不懂——所以向後相容是唯一真正的保險。

### 2. 會自動寫帳的邏輯出錯——最容易汙染資料
`processDueSubscriptions`（storage.ts）在**每次登入後自動執行**（App.tsx `AppShell` 的 `useEffect`），逐日補記到期訂閱為真實交易並推進 `nextBillingDate`。特性：錯誤在呼叫端 App.tsx 被 `catch(() => undefined)` 靜默吞掉；函式內有 guard<36 防無限迴圈。這是唯一「不經使用者確認就寫入帳本」的路徑，這裡的 bug 會直接在兩人帳本產生錯誤交易，且下次登入可能再次觸發。
**預防**：動它（或它依賴的 `getNextSubscriptionBillingDate`、id／去重格式）屬高危改動——必附日期推進的邊界測試（月底、閏年、跨年）＋去重測試；照 10-prod-safety §4 做人工驗證。
**救援**：錯誤交易可逐筆刪除（id 前綴 `sub-` 可辨識）；必要時把訂閱 `nextBillingDate` 改回正確日期。

### 3. 金錢計算回歸——最常發生
金額是 JS `number`（浮點、單位是「元」不是整數 cents）。已有 `src/services/money.ts` 的 `roundMoney`／`sumMoney`（整數 cents 運算防漂移），但**不是所有舊碼都用了**——實例：storage.ts `getCategoryBreakdown` 仍是裸 `+` 累加（已列 backlog，見 20-repo-map §地雷）。
**預防**：新寫或改到的金額運算一律過 money.ts helpers；改到錢的 PR 要附數字對拍證據（30-judgment-addendum §R-P1）。
**救援**：純顯示／統計層的錯不毀原始資料，修計算即可；但若錯的是「寫入端」（風險 2 的路徑），要先止血再清資料。

### 次要但真實的兩個

- **firestore.rules 改壞**：現行 rules 極簡（登入者只能讀寫自己 `users/{uid}` 子樹，其餘全拒）。改鬆＝資料外洩風險；改錯＝兩人被鎖死（app 所有讀寫失敗）。它幾乎永遠不需要動；要動＝先問 James，單獨部署（`firebase deploy --only firestore`），git 歷史隨時可回滾。
- **PWA 舊版快取**：更新採 `registerType: 'prompt'`（vite.config.ts）——deploy 後使用者要按 App 內橫幅的「立即更新」才換版。結論：**deploy ≠ 兩人都在跑新版**；涉及資料格式的改動要假設新舊版並行數天（回到風險 1 的向後相容要求）。

## 弱模型在本 repo 最容易漏 token／失焦的樣態

1. **整檔讀大檔**：screens/*.tsx 動輒數百行（含 .module.css 配對檔）。修法：先讀 `20-repo-map.md` 定位，再用 Read 的 offset/limit 只讀相關段；要掃多檔派 Explore（門檻照全域 ~/.claude/rules/10-dispatch.md §2）。
2. **被綠燈騙**：`npm run verify` 全綠 ≠ Firestore 行為正確（測試不碰 Firebase）。動了 storage.ts／rules／functions 卻只出示 verify 綠就宣稱完成＝不合格，照 10-prod-safety §4 補人工驗證。
3. **權限分類器故障漩渦**：本機 desktop session 會間歇出現 `cannot determine the safety`（含 `deepseek-... temporarily unavailable` 字樣）。SOP 在全域 CLAUDE.md 硬規則 7：這不是你的錯，切唯讀／改請 James 換 permission mode，別無限重試。
4. **順手修地雷**：看到 `getCategoryBreakdown` 裸加總這類已知問題就想順手改。除非任務就是它，否則記 backlog 別擴 scope（全域 20-judgment R4-b）。

## 本診斷的極限

基於 2026-07-05 的程式碼與 James 口述，沒有讀過 production Firestore 實際資料、Firebase Console 設定、兩人裝置狀態。與現況矛盾時以實測為準，並更新本檔（黃級流程，見全域 40-maintenance）。

## Changelog
- 2026-07-05 建檔（Fable 5 建置 session，James 授權）。
