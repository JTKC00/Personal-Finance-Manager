# 30 · 專案判斷 Rubric（補全域 20-judgment 的財務 app 特有判準）

> 全域 `~/.claude/rules/20-judgment.md` 照常適用；本檔只加本 repo 特有的判準。每條＝判準→動作，附正反例，對號入座即可。

## R-P1 「可以合進 main」的判定（全部成立才算）

- a. `npm run verify` 全綠，貼輸出尾段（CI Verify 也會擋，但本機先過）。
- b. 改到金錢計算（money.ts／financeLogic.ts／storage.ts 的聚合、或任何 amount 運算）→ 附**數字對拍**：同一組輸入，改動前後輸出一致；若不一致，逐筆解釋為什麼新值才是對的。對拍寫成 Vitest case 固定下來。
- c. 改到 storage.ts／functions／rules → 10-prod-safety §4 的人工驗證有紀錄。
- d. 新行為至少 1 個測試（純邏輯可測時）。
- e. 全域 20-judgment R2 的完成定義同時成立。

✅ 正例：把 getCategoryBreakdown 改用 sumMoney——附 Vitest：同一組含浮點噪音的 20 筆假交易，新舊實作逐分類比較，差異只有噪音清理（0.30000000000000004 → 0.3），列表證明。
❌ 反例：「改了聚合函式，verify 全綠所以完成」——verify 測不到你沒寫的對拍；沒有數字證據＝沒驗證（00-risks 樣態 2）。

## R-P2 「可以 deploy」的判定（比 R-P1 更嚴）

- R-P1 全過，**且** 10-prod-safety §1 checklist 逐項打勾，**且** James 知道要部署什麼、由他執行。
- 涉及資料格式 → 額外聲明並證明「舊版 app 讀新資料、新版 app 讀舊資料」都成立（§3 向後相容測試）。

✅ 正例：純 UI 文字修正——verify 綠、`--only hosting`、smoke §2 過、通知朋友按更新。
❌ 反例：「順便」把還沒人工驗證的 storage.ts 改動跟 UI 修正一起部署——混合部署讓出錯無法定位；一次只部署一個已驗證的改動集。

## R-P3 何時必問 James（本 repo 追加項；問法照全域 R3——批量問、附建議選項）

任一成立就停下來問：
- a. types/finance.ts 既有欄位的改名／改型別／改語意；資料 id 或去重鍵格式（20-repo-map §資料模型）。
- b. firestore.rules 或 Auth 流程的任何修改。
- c. 刪除或批次修改 production 資料（哪怕只是 James 自己帳號的）。
- d. 預設幣別、收支分類清單（src/constants/）——兩人的歷史資料掛在這些字串上。
- e. 會改變「兩人每天看到的數字」的計算邏輯變更——就算你認為舊行為是 bug，先確認那是 bug 不是特性。
- f. 任何要在 Firebase Console 動手的設定（quota、App Check、Auth providers）。

✅ 正例：發現 getGoalSavedAmount 對 withdraw 的夾零行為疑似 bug → 先寫測試把現行為釘住，帶著「現行為 vs 我認為的正確行為」兩案問 James，不直接改。
❌ 反例：幫按鈕加 aria-label、修 typo、補測試——不用問，做完在總結提一句即可。

## R-P4 數字不對時的除錯順序（照序做，禁止跳步）

1. **先固定再現**：把出錯的輸入寫成最小 Vitest case（放對應 *.test.ts）。不能再現 → 先懷疑資料而非碼：本機 dev 登入看該筆 Firestore 文件實際長怎樣（欄位缺漏？舊格式？）。
2. **由下而上定位**：money.ts（單元）→ financeLogic.ts（純邏輯）→ storage.ts（聚合＋IO）→ screen（顯示）。每層用 case 驗過才上一層。
3. **對照地雷清單**（20-repo-map §地雷）：多數數字問題出自 #2 裸加總、#3 UTC 日期、#5 預算無月份、#6 目標雙重真相。
4. **禁止**在 screen 層用 toFixed／四捨五入蓋掉下層的錯。✅ 正例：Dashboard 顯示 0.30000000000000004 → 往下找到漏用 sumMoney 的聚合處修掉。❌ 反例：在 JSX 裡 `.toFixed(2)` 了事——資料層還是錯的，下一個讀它的功能照樣炸。
5. 兩種修法都失敗 → 全域 20-judgment R4（換路，禁止第三次原地重試）。

## R-P5 制度檔的更新義務（以 repo 地圖為主）

- 判準：你的改動讓 20-repo-map.md **或任何其他制度檔（含 40-dispatch-fillins 的派工範例）**的一句話變成錯的（搬檔、改函式名、改資料流、清掉地雷、做掉 backlog）→ **同一個 PR 裡**更新對應行。
- 這是完成定義的一部分：地圖沒更新＝任務未完成（等同全域 R2-c 的未告知 TODO）。
✅ 正例：做掉 backlog #2 後，同 PR 更新 20-repo-map 三處（慣例反例、地雷 #2、backlog #2）標記已修復。
❌ 反例：「地圖只是參考文件，下次再說」——下一個 session 會照著錯地圖走進地雷。

## 路線設定：「一半一半」（James 2026-07-05 定調）

- 日常預設＝保守：小 diff、不動結構、不部署（沿用專案 memory「conservative changes」精神）。
- 加新功能＝照清單放行：R-P1 → R-P2 全鏈走完，一次一個功能，不夾帶重構。
- 重構／依賴升級：單獨 PR、單獨部署，跟功能改動隔離。

## Changelog
- 2026-07-05 建檔（Fable 5 建置 session）。
