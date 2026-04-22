# 手把手測試流程：混合模式 Gemini Key

## 0. 你現在要測什麼
你要測三件事：

1. **HTML 原型**：朋友可以在前端輸入自己的 Gemini Key，不用改 `.env`。
2. **OCR proxy**：`/api/ocr` 會優先用前端 key；沒有前端 key 才用 `.env` fallback。
3. **Expo App**：在「我的」頁輸入 key，去「記帳」頁拍照/相簿 OCR。

你的電腦 Wi-Fi IP 目前是：

```text
192.168.0.90
```

所以手機實機應該用：

```text
http://192.168.0.90:5173/api/ocr
```

---

## 1. 開一個終端機到專案資料夾
在 PowerShell 執行：

```powershell
cd "C:\Users\sgeus\OneDrive\桌面\~\Personal Finance Manager\Personal-Finance-Manager"
```

先確認你在正確位置：

```powershell
dir
```

你應該看到：

```text
personal_finance_manager.html
server.js
package.json
.env.example
src
```

---

## 2. 建立 `.env`
你目前打開的是 `.env.example`。不要直接把 key 放進 `.env.example`，因為它是範例檔。

在 PowerShell 執行：

```powershell
Copy-Item .env.example .env
```

然後打開 `.env`。

### 如果你想測「朋友用自己的 key」
建議 `.env` 這樣：

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite-preview
PORT=5173
EXPO_PUBLIC_OCR_PROXY_URL=http://192.168.0.90:5173/api/ocr
```

這樣 server 沒有 fallback key，必須由前端輸入 key。

### 如果你想測「混合 fallback」
可以這樣：

```env
GEMINI_API_KEY=你的GeminiKey
GEMINI_MODEL=gemini-3.1-flash-lite-preview
PORT=5173
EXPO_PUBLIC_OCR_PROXY_URL=http://192.168.0.90:5173/api/ocr
```

這樣前端沒輸入 key 時，server 會用你的 `.env` key。

---

## 3. 重啟 prototype server
如果之前已經開過 server，先關掉 5173：

```powershell
$conns=Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
foreach($c in $conns){ Stop-Process -Id $c.OwningProcess -Force }
```

然後啟動：

```powershell
npm run prototype
```

如果 `npm` 找不到，就用：

```powershell
& "C:\Program Files\nodejs\npm.cmd" run prototype
```

看到類似這個就成功：

```text
Personal Finance Manager prototype: http://localhost:5173
Gemini OCR model: gemini-3.1-flash-lite-preview
```

這個終端機先不要關。

---

## 4. 測 proxy 是否活著
另開一個 PowerShell，執行：

```powershell
Invoke-WebRequest -Uri "http://localhost:5173/" -UseBasicParsing
```

成功時會看到 `StatusCode : 200`。

再測 OCR endpoint。

### `.env` 沒有 key 時
執行：

```powershell
Invoke-WebRequest -Uri "http://localhost:5173/api/ocr" -Method POST -Body "{}" -ContentType "application/json" -UseBasicParsing
```

預期會報錯，但內容應該是：

```json
{"error":"Gemini API key is required"}
```

這是正確的，代表沒有前端 key、也沒有 server fallback。

### 測「有前端 key path」
執行：

```powershell
Invoke-WebRequest -Uri "http://localhost:5173/api/ocr" -Method POST -Headers @{"x-gemini-api-key"="fake"} -Body "{}" -ContentType "application/json" -UseBasicParsing
```

預期內容應該變成：

```json
{"error":"imageBase64 is required"}
```

這代表 proxy 已接受「前端傳 key」這條路，只是你沒有給圖片。

---

## 5. 測 HTML 原型
在瀏覽器打開：

```text
http://localhost:5173/
```

然後照做：

1. 到「收據」或 OCR 區塊。
2. 找到 `Gemini Key` 輸入欄。
3. 貼上你自己的 Gemini API Key。
4. 按「儲存」。
5. 重新整理頁面。
6. 確認 key 仍然存在輸入欄裡。

這代表 key 已存到瀏覽器 `localStorage`。

### 測 HTML OCR
1. 點「點擊上傳圖片」。
2. 選一張收據/發票圖片。
3. 等待 OCR。
4. 預期結果：
   - 金額、分類、日期、備註會被預填。
   - 若低信心，欄位會標紅或提示確認。
   - 不會自動入帳，必須按「確認入帳」。

### 測沒有 key 的情境
1. 按「清除」。
2. 如果 `.env` 也沒有 `GEMINI_API_KEY`，再上傳圖片。
3. 預期：
   - OCR 失敗提示你輸入 Gemini Key。
   - 保留手動輸入 fallback。
   - 不會直接入帳。

---

## 6. 測 Expo TypeScript
先確認 typecheck：

```powershell
npm run typecheck
```

如果 `npm` 找不到：

```powershell
& "C:\Program Files\nodejs\npm.cmd" run typecheck
```

預期：沒有 error。

---

## 7. 啟動 Expo
另開 PowerShell，到同一個專案資料夾：

```powershell
cd "C:\Users\sgeus\OneDrive\桌面\~\Personal Finance Manager\Personal-Finance-Manager"
```

啟動 Expo：

```powershell
npm run start
```

如果 `npm` 找不到：

```powershell
& "C:\Program Files\nodejs\npm.cmd" run start
```

Expo 會出現 QR code。

手機要和電腦在同一個 Wi-Fi，並確保 VPN/防火牆沒有擋住 `192.168.0.90:5173`。

---

## 8. 在 Expo 手機 App 測 Key
用 Expo Go 掃 QR code，打開 App。

1. 到「我的」頁。
2. 找到 Gemini API Key 區塊。
3. 輸入自己的 Gemini Key。
4. 按「儲存 Key」。
5. 應看到狀態變成「已設定本機 Key」。

這個 key 會存在手機的 SecureStore，不是 AsyncStorage。

---

## 9. 在 Expo 測 OCR
1. 到「記帳」頁。
2. 按「拍照掃描」或「相簿選取」。
3. 第一次會問相機/相簿權限，按允許。
4. 選一張收據。
5. 預期：
   - App 呼叫 `http://192.168.0.90:5173/api/ocr`
   - proxy 使用手機 SecureStore 裡的 Gemini key
   - 表單會預填金額、分類、日期、備註
6. 檢查欄位正確後按「新增」。
7. 交易應出現在本月交易列表。
8. 回到「首頁」，摘要數字應更新。

---

## 10. 測交易 CRUD
在 Expo「記帳」頁：

### 新增
1. 手動輸入金額。
2. 選分類。
3. 按「新增」。
4. 本月交易列表應出現新交易。

### 編輯
1. 在交易列表按「編輯」。
2. 改金額或備註。
3. 按「儲存變更」。
4. 列表應更新。

### 刪除
1. 在交易列表按「刪除」。
2. 確認刪除。
3. 該交易應消失。
4. 回首頁，摘要應同步更新。

---

## 11. 常見問題
### 手機 OCR 連不上
先在手機瀏覽器打開：

```text
http://192.168.0.90:5173/
```

如果手機瀏覽器也打不開，通常是：

- 手機和電腦不在同一 Wi-Fi
- Windows 防火牆擋住 Node.js
- Surfshark/VPN 擋住 LAN
- 電腦 IP 變了

重新查 IP：

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object IPAddress,InterfaceAlias
```

找 `Wi-Fi` 那個 IP，更新 `.env`：

```env
EXPO_PUBLIC_OCR_PROXY_URL=http://新的IP:5173/api/ocr
```

然後重啟 Expo。

### HTML 改了但沒效果
重啟 prototype server：

```powershell
$conns=Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
foreach($c in $conns){ Stop-Process -Id $c.OwningProcess -Force }
npm run prototype
```

### Expo 改了但手機沒更新
在 Expo terminal 按：

```text
r
```

或重新掃 QR code。

---

## 12. 最小成功標準
測試成功的定義：

- HTML 可以輸入自己的 Gemini Key 並完成 OCR。
- HTML 清除 key 後，在沒有 `.env` fallback 時會明確提示需要 key。
- Expo「我的」頁可以儲存/清除 Gemini Key。
- Expo「記帳」頁可以用該 key 拍照/相簿 OCR。
- OCR 結果只預填，不會未確認直接入帳。
- 新增/編輯/刪除交易後，首頁摘要會更新。
