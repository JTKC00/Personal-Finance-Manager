# 10 · 生產安全守則（deploy／schema／資料／備份）

> 讀者：要做任何可能影響線上的動作的模型。背景診斷見 00-risks.md。
> 核心原則：**Firestore 裡那份資料是唯一的一份**（2026-07-05 確認無備份）。寧可不做，不可弄壞。

## §1 deploy 前 checklist（逐項打勾，缺一不可）

1. `npm run verify` 全綠（貼輸出尾段）；CI 的 Verify 也綠。
2. 這次改動如果動到 storage.ts／functions／firestore.rules／資料格式 → §4 的人工驗證已做完並有紀錄。
3. 部署前先確認狀態：`git status` 乾淨、在 main、已 pull——因為 predeploy 會自動 build「當下工作目錄」的碼（firebase.json 的 hosting.predeploy 與 functions.predeploy）。
4. 選最小部署範圍：
   - 只改前端 → `firebase deploy --only hosting`
   - 只改 Functions → `firebase deploy --only functions`
   - 只改 rules → `firebase deploy --only firestore`
   - 不帶 `--only` 會三樣全部部署——除非三樣都改了，否則不要用。
5. James 本人執行指令，或由他當回合明確授權（專案 CLAUDE.md 硬規則 4）。模型把指令準備好貼給他，一次一條，附「怎樣算成功」。
6. deploy 完成後照 §2 smoke 一輪。
7. 通知另一位使用者：app 頂部會出現「App 有新版本」橫幅，請按「立即更新」。兩人都更新前，假設新舊版並行（00-risks 風險 1）。

## §2 deploy 後 smoke 清單（約 3 分鐘，在正式網址上做；網址見 DOC/ 手冊）

改動前先記下 Dashboard 的本月收入／支出／餘額三個數字。按順序，任何一步不對→立刻跳 §6：
1. 開 app → 重新整理 → 出現更新橫幅就按「立即更新」。
2. 登入成功，Dashboard 三個數字與改動前一致。
3. 新增一筆測試支出：分類「其他」、備註 `TEST-煙霧測試`、金額 1 → 交易列表看得到、Dashboard 支出 +1。
4. 刪掉這筆測試交易 → 數字復原。
5. 訂閱頁、分析頁、目標頁各開一次，能渲染、無錯誤畫面。
6. 若這次改了 OCR／functions：上傳一張收據試掃（注意 quota：預設每人每日 20 次）。

## §3 schema／資料格式變更協議

「schema」包括：types/finance.ts 的欄位、Firestore 文件結構（`users/{uid}/{transactions|subscriptions|goals|accounts|transfers|receipts}`、`meta/{budgets|events}` 與 `budgetMonths/{YYYY-MM}`）、以及**資料 id 與去重鍵格式**（`sub-{訂閱id}-{日期}`、`txn-{交易id}`、`{subscriptionId}:{date}`——00-risks 風險 1）。

規則（全部強制）：
1. **只加不改**：新需求用「新增可選欄位」解決；不改既有欄位的名稱、型別、語意，不改 id 格式。做不到 → 停下，把「為什麼做不到」帶給 James（全域 20-judgment R3）。
2. **讀取端防禦**：新欄位在讀取端給 fallback，範本：financeLogic.ts 的 `normalizeGoal`（缺 id 補 id、缺 type 推斷 type；舊 standalone goal 只有 savedAmount 時補 deterministic 期初存款 entry）。
3. **向後相容測試**：用「舊格式的假資料」寫一個 Vitest case，證明新碼讀舊資料不炸、數字正確。
4. **migration（真的要改既有資料時）**：(a) 先問 James；(b) 先照 §5 做一次備份；(c) 寫唯讀 dry-run 腳本，列出「會改哪些文件、改成什麼」給 James 看；(d) 先跑 James 自己帳號的資料，smoke 過了再處理朋友的帳號；(e) 全程留紀錄。

## §4 storage.ts／Functions／rules 的驗證

一般 Vitest 不連 Firebase；`npm run test:integration` 會連本機 Auth／Firestore emulator，現已覆蓋 Account/Transfer、訂閱自動入帳、月度 Budget、Backup Restore。改到這四條時要更新整合測試並貼 emulator 真實執行證據；其他未覆蓋區域仍需補 emulator case 或人工驗證——「理論上沒問題」不算：
- **storage.ts**：優先用 demo project emulator 做建→讀→改→刪與重新讀回。若改到 emulator 尚未覆蓋的 UI／離線／多裝置行為，再用本機 `npm run dev` 登入 James 自己帳號，以 `TEST-` 前綴人工驗證並清除測試資料。
- **functions/（OCR）**：需要本機測 OCR 時，請 James 自己在 `.env` 填 `VITE_OCR_PROXY_URL`（只告訴他改哪個欄位，模型不開該檔——專案 CLAUDE.md 硬規則 5）；或部署後在正式站掃一張測試收據。
- **firestore.rules**：原則上不要動（00-risks）。真要動：問 James → 只用 `--only firestore` 部署 → 立刻在 app 驗證兩人仍可正常讀寫 → git 歷史留著隨時回滾。

## §5 備份／Restore

現況（2026-08-07 更新）：app 內已有**手動**完整 JSON／CSV 匯出、30 日提醒，以及受控 Restore（schema 驗證 → 日期／數量 → 差異預覽 → 自動下載 pre-restore 現況備份 → 明確確認後取代）。Backup Restore 已有 Auth／Firestore emulator 整合測試；但備份仍是手動下載，沒有自動／排程備份。
- 選項（優先序）：(1) ✅ 已完成——app 內完整 JSON 匯出與受控 Restore；定期匯出提示已完成；(2) Firebase 官方 Firestore export——需要 GCS bucket，是否需要 Blaze 方案【UNVERIFIED，動手前先查官方文件】；(3) admin SDK 腳本——涉及 service account 金鑰，非必要不走（專案 CLAUDE.md 硬規則 5、6）。
- 自動／排程備份完成之前，一切「寫 production 資料」的操作仍先確認最近一次完整 JSON 備份可用；能不寫就不寫。

## §6 出事了怎麼辦（rollback）

1. **先止血**：請 James 通知兩人暫停使用；不要急著改資料。
2. **前端壞**：回滾上一個好版本。方法 A【UNVERIFIED：確切介面步驟】：Firebase Console → Hosting → 發布歷史 → 回滾上一版。方法 B（一定可行）：`git checkout <上一個好 commit>` → `firebase deploy --only hosting`（James 執行）→ 驗證 → 回 main 修。
3. **functions 壞**：同方法 B，改用 `--only functions`。
4. **rules 壞**：從 git 歷史取回舊 rules → `--only firestore`。
5. **資料被寫壞**：先評估範圍（哪些文件、哪個帳號、可否由 id 前綴辨識如 `sub-*`）再動手；逐筆修復優於批次腳本；全程先問 James。
6. 事後：教訓寫 `~/.claude/rules/lessons.md`（[PFM] 標記）；必要時更新 00-risks。

## §7 do-not-touch 清單

- `.env`（機密；讀取、引用、複製皆禁止）
- `dist/`、`functions/lib/`（build 產物）、`.firebase/`（cache）、`firebase-debug*.log`
- `server.js`（早期 prototype，不是正式後端；OCR 正式路徑是 hosting rewrite `/api/ocr` → Cloud Run，見 firebase.json）
- `DOC/`（給 James 看的人類手冊；要改先問他）
- `node_modules/`、`functions/node_modules/`

## §8 待驗證清單（下一個有 Bash 權限的 session 順手做掉）

- [x] 2026-07-05 已驗：`git ls-files .env` 輸出為空——.env 從未被 git 追蹤 ✓。（若未來重驗變成有輸出 → 立刻停下告訴 James：金鑰已進 git 歷史，需要換 key。）
- [ ] Firebase Hosting 的 Console 回滾步驟：查官方文件或實測，解掉 §6 方法 A 的【UNVERIFIED】。
- [ ] Firestore export 是否需要 Blaze【UNVERIFIED】（§5 選項 2）。

## Changelog
- 2026-07-05 建檔（Fable 5 建置 session，James 授權）。
