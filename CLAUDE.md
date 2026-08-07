# Personal Finance Manager — 專案守則 v1.0（2026-07-05 由 Fable 5 建置）

**這是已上線的 live app**：James 與一位好友日常使用中，Firestore 裡是兩人的真實財務紀錄。
任何改動都可能影響真人真錢的資料。全域制度（`~/.claude/CLAUDE.md` 與 `~/.claude/rules/`）照常適用，本檔只加專案層規則。

## 速覽
- 技術棧：React 19 + TypeScript + Vite 6 + Firebase（Auth / Firestore / Functions v2 / Hosting）+ PWA。細節見 README.md。
- 資料流：screens → src/services/storage.ts → Firestore `users/{uid}/...`（兩位使用者各自隔離）。金錢計算集中在 src/services/money.ts + financeLogic.ts；型別唯一來源 src/types/finance.ts。地圖：`.claude/rules/20-repo-map.md`。
- 驗證鏈：`npm run verify`（typecheck + lint + 純邏輯 Vitest + Auth／Firestore emulator 整合測試 + build + functions build）。Functions／OCR 行為仍未有自動整合測試。
- 流程：開 branch → PR → CI Verify 綠 → merge main。**merge ≠ 上線**；部署一律 James 手動 `firebase deploy`。

## 硬規則（無條件適用）
1. 【驗證】宣稱改動完成前：`npm run verify` 全綠並出示輸出尾段。動了 storage.ts、firestore.rules 或 functions/ → 確認 emulator 整合測試是否覆蓋；未覆蓋部分另附人工驗證計畫（`.claude/rules/10-prod-safety.md` §4）。
2. 【金錢】任何金額加總或運算用 src/services/money.ts 的 roundMoney / sumMoney，禁止裸浮點運算。改到金錢計算 → 附改前改後數字對拍（`.claude/rules/30-judgment-addendum.md` §R-P1）。
3. 【schema】動 src/types/finance.ts 既有欄位、資料 id 格式（`sub-*`、`txn-*` 等）、或 firestore.rules 之前：必讀 10-prod-safety §3 且先問 James。純新增可選欄位不在此限。
4. 【deploy】只有 James 本人執行 firebase deploy（或他當回合明確授權）。
5. 【機密】永不讀取或引用 .env 內容；不把部署網址／Firebase project id 寫進任何新檔（現有 DOC/ 手冊除外）。
6. 【資料】任何會寫入 production Firestore 的腳本或手動操作（migration、修資料）：先問 James，並先確認已匯出完整 JSON 備份（見 10-prod-safety §5）。

## 路由表（用到才讀，都在 `.claude/rules/`）
| 情境 | 讀這份 |
|---|---|
| 要 deploy／rollback／改 schema 或資料／備份 | 10-prod-safety.md |
| 找檔案、理解架構、金錢與日期慣例、已知地雷與 backlog | 20-repo-map.md |
| 判斷：可合併？可上線？何時問 James？數字錯了怎麼追？ | 30-judgment-addendum.md |
| 要派 subagent（本 repo 的填空值與範例） | 40-dispatch-fillins.md |
| 制度來歷、交接欄、退化預防 | 50-letter-pfm.md |
| 專案風險背景（各檔引用的診斷依據） | 00-risks.md |

路由指到的檔案不存在＝建置中斷：查 50-letter-pfm.md 交接欄，它也不在就回報 James。

## 維護
- 教訓寫全域 `~/.claude/rules/lessons.md`，條目加 [PFM] 標記（單一教訓簿，不另開檔）。
- 改了 20-repo-map.md 描述的結構卻沒更新該檔＝任務未完成（30-judgment-addendum §R-P5）。
- 本檔上限 50 行；語意變更走全域 `~/.claude/rules/40-maintenance.md` 黃級流程。
