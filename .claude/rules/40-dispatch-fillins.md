# 40 · 派工填空值與範例（本 repo 專用）

> 模板骨架在全域 `~/.claude/rules/30-templates.md`（T1 搜尋／T2 實作／T3 批次／T4 研究／T5 驗收），照抄那邊的格式，【已知情報】【驗收條件】用本檔的值填。
> ⚠️ 本機 desktop session 派工**省略 model 參數**（繼承主對話模型，原因見全域 10-dispatch §1 desktop 陷阱欄）；權限分類器故障時 Agent 可能整個不可用——照全域 CLAUDE.md 硬規則 7 處理，退回主對話自做＋明說「驗收未經獨立 agent」。

## 通用填空值（直接抄進派工單）

- 專案根目錄：`/Users/jamestong/Desktop/Development/Personal Finance Manager`（**路徑含空格，指令記得加引號**）
- 驗證指令：`npm run verify`（全鏈）；只跑測試 `npm run test`；只查型別 `npm run typecheck`
- 搜尋範圍：`src/**/*.{ts,tsx}` 與 `functions/src/**/*.ts`；排除 `dist/`、`node_modules/`、`server.js`
- 要求 subagent 先讀：`CLAUDE.md` 與 `.claude/rules/20-repo-map.md`（在派工 prompt 裡明寫）
- 慣例摘要（貼進【已知情報】）：金額運算必過 src/services/money.ts 的 roundMoney／sumMoney；日期用 YYYY-MM-DD 本地時區字串（formatDateKey）；Firestore 寫入必經 clean()；純邏輯測試放 src/services/*.test.ts
- 紅線（貼進每張派工單的【不要做】）：不碰 .env；不動 firestore.rules、types/finance.ts 既有欄位、資料 id 格式；不執行 firebase deploy；不寫「會連 production Firebase」的程式並執行

⚠️ 下方 T1／T2 範例原以 backlog #2（getCategoryBreakdown）為題，**該項已於 2026-07-05 完成**（storage 委派給 financeLogic `sumExpensesByCategory`）。範例保留作**格式參考**；要實際套用同型工作，改指向 20-repo-map §backlog 待辦「screens 分類 map 仍裸浮點加總」（AnalysisScreen/DashboardScreen/SubscriptionsScreen）。

## T1 搜尋——已填好的完整範例

```
【目標】找出所有「金額運算沒有經過 src/services/money.ts」的位置。
【動機】執行 20-repo-map backlog #2 前，先盤點同類問題的完整範圍。
【已知情報】專案根目錄 /Users/jamestong/Desktop/Development/Personal Finance Manager；已知 storage.ts getCategoryBreakdown（:527 附近）是一處；helpers 是 roundMoney/sumMoney（money.ts）。
【要做】搜 src/**/*.{ts,tsx}：對 amount、initialBalance、savedAmount、targetAmount 做 + - * / 或 reduce 累加、且結果未經 roundMoney/sumMoney 的位置。每處記 檔案:行號＋一行說明。
【不要做】不讀整檔；不判斷「要不要修」；純顯示用的字串模板拼接不算。
【驗收條件】(1) 每處附 檔案:行號 (2) 明說「找完了」或「還剩哪些目錄沒掃」(3) 必須找到 storage.ts 的 getCategoryBreakdown——沒找到＝方法有漏，重做。
【回報格式】照全域 30-templates 通用尾段。
```

## T2 實作——已填好的完整範例（就是 backlog #2，可直接派）

```
【目標】把 storage.ts 的 getCategoryBreakdown（:527 附近）裸浮點累加改用 sumMoney。
【動機】金額慣例要求所有加總過 money.ts（專案 CLAUDE.md 硬規則 2）；此函式餵 Analysis 頁的分類圖表。
【已知情報】專案根目錄 /Users/jamestong/Desktop/Development/Personal Finance Manager（路徑含空格）；sumMoney 簽名 sumMoney(amounts: number[]): number（money.ts:21）；同檔 getMonthlySummary（:515）是正確用法範本；測試放 src/services/storage 相關邏輯若不可測，退而把分組邏輯抽成純函式再測；跑 npm run test。
【要做】(1) 改為按分類分組後各自 sumMoney；(2) 加 Vitest：含 0.1+0.2 型浮點噪音的假交易組，斷言各分類總額精確；(3) 數字對拍：新舊實作對同一組 fixture 的輸出，差異只能是浮點噪音清理，逐分類列表。
【不要做】不動同檔其他函式；不改函式簽名（回傳仍是 Record<string, number>）；不碰 .env；不動 firestore.rules、types/finance.ts 既有欄位、資料 id 格式；不執行 firebase deploy；不寫會連 production Firebase 的程式並執行。
【驗收條件】(1) npm run verify 全綠貼尾段 (2) 新測試存在且覆蓋浮點案例 (3) 對拍表在回報裡 (4) 改動只有 getCategoryBreakdown＋測試 (5) 同 PR 更新 20-repo-map 三處（慣例反例、地雷 #2、backlog #2）——R-P5。
【回報格式】照全域 30-templates 通用尾段。
```

## T3 批次／T4 研究／T5 驗收——填空提示

- **T3**：本 repo 很小（services 13 檔、screens 8 頁），多數「批次」≤5 檔＝主對話自己做（全域 10-dispatch §2 門檻）。真要派：邊界規則必寫「*.test.ts 內的字面數字期望值不改」。
- **T4** 常用題：Firebase 部署／rollback／export 的官方文件查證（10-prod-safety §8 的 UNVERIFIED 清單）。驗收條件要求「每個斷言附官方文件 URL，查不到標 UNVERIFIED」。
- **T5**：驗收條件從原派工單**原樣複製**；產物涉及金錢計算時加一條「用自己新造的 fixture 重算對拍，不許沿用實作者的 fixture」。

## Changelog
- 2026-07-05 建檔（Fable 5 建置 session）。
