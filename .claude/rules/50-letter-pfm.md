# 50 · 給未來 session 的信（Personal Finance Manager 專案版）

寫信人：Claude Fable 5（2026-07-05）。讀信人：之後在本 repo 工作的每個模型。全域那封 `~/.claude/rules/50-letter.md` 講這台機器與使用者；這封只講這個 repo。三件 James 沒問、但你遲早要面對的事：

## 一、那份資料沒有第二份

兩個真人的完整財務紀錄只存在 Firestore 一處（2026-07-05 James 確認無備份）。這改變所有風險計算：程式碼壞了可以回滾（git 什麼都記得），**資料壞了沒有任何東西可以回滾**。所以 10-prod-safety 對「寫 production 資料」近乎偏執——那不是官僚主義。你能做的最有價值的一件事可能不是任何新功能，而是推進 backlog #1（in-app export）。在那之前，對一切寫資料的操作保持敬畏。（2026-07-05 更新：in-app export 已完成、並補上 accounts＋transfers；但仍是手動匯出、無自動備份，下一個高價值項是「還原/匯入」與定期匯出提示——對寫 production 的敬畏不變。）

## 二、綠燈只照亮一半的路

`npm run verify` 很好用，但它的測試不碰 Firebase——storage.ts、firestore.rules、functions 是測試盲區，而它們恰好是最能弄壞東西的地方（00-risks）。「verify 全綠」在這個 repo 的正確翻譯是「純邏輯沒退化」，不是「可以上線」。上線判準在 30-judgment R-P2。別讓綠色勾勾給你虛假的安全感。

## 三、你的每次 deploy 都是對別人的生產環境動手

第二位使用者不在對話裡，不會替自己說話。他的裝置要手動按「立即更新」才換版，所以每次 deploy 後的世界是「新舊版並行、讀寫同一份資料」——這就是為什麼向後相容是硬規則不是 best practice。改「他每天看到的數字」之前（R-P3-e），記得那數字對他不是測試資料，是他的錢。

## 這套專案制度最可能的退化方式與預防

1. **地圖腐爛**：20-repo-map 的行號與描述隨改動漂移，模型開始「參考但不信」，最後沒人讀。預防：R-P5 把更新地圖綁進完成定義；發現地圖錯了，修地圖永遠比繞過它便宜。
2. **「只是小改」侵蝕**：硬規則被「這次只是改個文案」逐次繞過，直到某次「小改」動了 storage.ts。預防：CLAUDE.md 硬規則不設例外；覺得規則太重就走全域 40-maintenance 黃級流程改規則，不要違規。
3. **backlog 變垃圾場**：越積越多沒人做，檔案失去公信力。預防：backlog 上限 8 條，超過就先刪最不重要的一條或做掉一條。
4. **教訓失散**：忘了 [PFM] 標記或另開教訓檔。預防：只有一本教訓簿＝`~/.claude/rules/lessons.md`。

## 交接欄（session 收尾時更新）

- 2026-07-05 建置：CLAUDE.md＋00／10／20／30／40／50 六檔全部落地。
- 建置當日的已知缺口（下個 session 可接手）：
  - 對抗審查與 commit 已完成，狀態見檔尾補記。
  - 10-prod-safety §8：.env 追蹤檢查已做掉（從未入 git ✓）；剩 Console rollback 步驟、export 是否需 Blaze 兩項未驗。
  - functions/src/index.ts 未深讀（僅從 README 與呼叫端 ocr.ts 理解）；要動 OCR 後端，先自己讀一遍。
  - 兩人是否單幣使用未確認（20-repo-map 慣例節【UNVERIFIED】）。

### 補記（2026-07-05 收尾）
- 對抗審查：fresh general-purpose agent 完成 26 步審查——事實核對 19 個行號全數命中、誤讀測試 5/5 通過；必修 2 條（§4 的 .env 指示與機密紅線相撞、制度檔未 commit）＋建議 6 條，已全部修正。
- 制度檔已 commit（分支 chore/claude-project-rules，未 push）；推上 GitHub 與合併由 James 決定。
- 本 session 期間權限分類器間歇故障，教訓已追加至全域 lessons（2026-07-05 兩條）；James 中途切 accept edits 解鎖。

### 補記二（2026-07-08，Fable 回訪覆核）
- 制度被實際使用並生效：後續 session 照 backlog 完成三項修復（已併 main：f174ea2／75cf3f9／5c1bac2），並照 R-P5 做了制度同步（eca9266）、照維護協議寫了 [PFM] 教訓——驗證迴路運轉正常。
- 覆核 Opus 代跑的收尾：執行乾淨（verify／機密掃描／commit）；其口頭建議「本地 merge 進 main」有坑（main 有 branch protection，push 會被拒）——正確路徑是 push 分支開 PR。
- 本次覆核：分支 rebase 到最新 main；補齊 eca9266 漏掉的殘留舊引用（20-repo-map 日期／幣別行與 storage 表格、40-dispatch T1 範例、00-risks 前提與風險 3、30-judgment R-P4）。
- **重要教訓**：制度檔留在未合併分支上＝新 session（在 main 上開）完全看不到——已記全域 lessons 2026-07-08。在合併前，這套制度只在 chore/claude-project-rules 分支上生效。

### 補記三（2026-07-18，兩個新功能上線）
- 完成並**已部署到正式站**：backlog #2（screens 金額聚合修復，PR #29）、備份提醒（PR #30）、預算月份化＋budgetMonths（PR #33，動 storage.ts）。三個 PR 皆各自跑過 max-effort code review 或聚焦審查，皆有必修缺陷被抓到並修正——制度的審查流程不是走過場，這三次都真的攔到東西：
  - PR #29：4 條 findings（reuse 共用內核、simplification 收斂 ratio 表達式、test-coverage 假信心測試、地圖聲明過寬），全修。
  - PR #33：1 條必修**資料遺失 bug**——`resolveBudgetMonth` 讓「當月月文件」贏過 legacy，會在兩人新舊版裝置並存時（00-risks 風險 1 的具體實例）靜默丟失剛寫入的預算值；已修正為當月一律讀 legacy，並補測試釘住。這是本專案制度第一次在合併前攔到會實際遺失使用者資料的 bug，值得當範例：**審查不是形式，是真的會抓到東西**。
- §4 人工驗證：James 本人在本機 dev 登入操作 8 步驟（存值→重新整理→Dashboard/Subscriptions/Analysis 檢查→匯出 JSON 驗證 budgetMonths），全數正常後才合併。
- 兩個 PR（backup-reminder、monthly-budgets）平行開發、各自動了 ProfileScreen.tsx 與同幾份制度檔，先合併的那個讓後合併的產生 3 個檔案衝突（皆為雙方各自新增、非真矛盾，合併後重跑 verify 全綠）——教訓見全域 lessons 2026-07-18。
- deploy 已執行（`firebase deploy --only hosting`，James 本人跑指令），正式站 smoke test 全數通過。
- 本 session 過程中 Browser pane 的 dev server／分頁多次在輪次間被重置、10 個平行審查 agent 一次打爆 session 額度——皆已記全域 lessons 2026-07-18，下個 session 遇到同款狀況直接查那幾條，不用重新摸索。
- **已知缺口**：GitHub Dependabot 掃出 27 個依賴漏洞（1 critical、10 high）尚未處理，已有 spawn_task 待處理（任務名稱「處理 Dependabot 漏洞警報」）；backlog 待辦 #1–#4（restore／匯入、幣別分類、screens UTC-today、calculateBudgetUsage 重構）皆未動。
