import {useRef, useState} from 'react';
import {Card} from './Card';
import {useSubscriptionProcessing} from '../contexts/SubscriptionProcessingContext';
import {daysSinceBackup, getLastBackupAt, markBackupDone} from '../services/backupReminder';
import {
  countFinanceBackupItems,
  diffFinanceBackups,
  financeBackupDataFingerprint,
  type BackupDiffRow,
  type FinanceBackup,
  validateFinanceBackup,
} from '../services/financeBackup';
import {createFinanceBackup, restoreFinanceBackup} from '../services/storage';
import styles from './BackupRestoreCard.module.css';

type RestorePreview = {
  backup: FinanceBackup;
  currentFingerprint: string;
  diff: BackupDiffRow[];
  fileName: string;
};

type Props = {
  userEmail: string;
  onRestoreComplete: () => Promise<void>;
  showToast: (message: string) => void;
};

const maxBackupBytes = 20 * 1024 * 1024;

function downloadBackup(backup: FinanceBackup, prefix: string) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {type: 'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${prefix}-${backup.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function failureReason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function formatBackupDate(value: string): string {
  return new Intl.DateTimeFormat('zh-HK', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value));
}

export function BackupRestoreCard({userEmail, onRestoreComplete, showToast}: Props) {
  const {processing: subscriptionsProcessing} = useSubscriptionProcessing();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(() => getLastBackupAt());
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [restoreError, setRestoreError] = useState('');
  const [checking, setChecking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [exporting, setExporting] = useState(false);

  const backupDays = daysSinceBackup(lastBackupAt);
  const backupStatusText = backupDays === null ? '從未備份' : backupDays === 0 ? '今天' : `${backupDays} 天前`;

  async function exportJsonBackup() {
    setExporting(true);
    try {
      const backup = await createFinanceBackup(userEmail);
      downloadBackup(backup, 'finance-backup');
      markBackupDone(backup.exportedAt);
      setLastBackupAt(backup.exportedAt);
      showToast('完整 JSON 備份已匯出。');
    } catch (error: unknown) {
      showToast(`備份失敗：${failureReason(error)}`);
    } finally {
      setExporting(false);
    }
  }

  async function selectRestoreFile(file: File | undefined) {
    setPreview(null);
    setValidationErrors([]);
    setRestoreError('');
    if (!file) return;
    if (file.size > maxBackupBytes) {
      setValidationErrors(['備份檔案超過 20 MB，為安全起見未載入。']);
      return;
    }

    setChecking(true);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = validateFinanceBackup(parsed);
      if (!result.ok) {
        setValidationErrors(result.errors.slice(0, 20));
        return;
      }
      const current = await createFinanceBackup(userEmail);
      setPreview({
        backup: result.backup,
        currentFingerprint: financeBackupDataFingerprint(current),
        diff: diffFinanceBackups(current, result.backup),
        fileName: file.name,
      });
    } catch (error: unknown) {
      setValidationErrors([`無法讀取備份：${failureReason(error)}`]);
    } finally {
      setChecking(false);
    }
  }

  async function executeRestore() {
    if (!preview || restoring || subscriptionsProcessing) return;
    if (!window.confirm('還原會用備份內容取代目前資料，預覽中的移除項目將被刪除。系統會先下載現況備份。確定繼續？')) return;

    setRestoring(true);
    setRestoreError('');
    try {
      const current = await createFinanceBackup(userEmail);
      const currentFingerprint = financeBackupDataFingerprint(current);
      if (currentFingerprint !== preview.currentFingerprint) {
        setPreview(currentPreview => currentPreview ? {
          ...currentPreview,
          currentFingerprint,
          diff: diffFinanceBackups(current, currentPreview.backup),
        } : null);
        setRestoreError('現有資料在預覽後已有變更。差異已更新，請重新檢查後再確認。');
        return;
      }

      downloadBackup(current, 'finance-pre-restore');
      markBackupDone(current.exportedAt);
      setLastBackupAt(current.exportedAt);
      await restoreFinanceBackup(preview.backup);
      await onRestoreComplete();
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      showToast('資料還原完成；還原前現況備份亦已下載。');
    } catch (error: unknown) {
      setRestoreError(`還原未完成：${failureReason(error)}。請保留剛下載的現況備份。`);
    } finally {
      setRestoring(false);
    }
  }

  const changedItems = preview?.diff.reduce((total, row) => total + row.added + row.updated + row.removed, 0) ?? 0;

  return (
    <Card title="資料備份與還原">
      <p className={styles.body}>完整 JSON 備份包含交易、目標、訂閱、預算、收據、帳戶及轉帳。還原前會先驗證、預覽差異及自動下載目前資料。</p>
      <p className={styles.status}>上次完整備份（此裝置）：{backupStatusText}</p>
      <div className={styles.actions}>
        <button className={styles.primaryBtn} disabled={exporting || restoring} onClick={() => void exportJsonBackup()}>
          {exporting ? '匯出中…' : '匯出完整 JSON 備份'}
        </button>
        <button className={styles.secondaryBtn} disabled={checking || restoring} onClick={() => fileInputRef.current?.click()}>
          {checking ? '驗證中…' : '選擇備份檔案'}
        </button>
        <input
          ref={fileInputRef}
          className={styles.hiddenInput}
          type="file"
          accept="application/json,.json"
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void selectRestoreFile(file);
          }}
        />
      </div>

      {validationErrors.length ? (
        <div className={styles.errorBox} role="alert">
          <p className={styles.errorTitle}>備份格式驗證失敗</p>
          <ul>{validationErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul>
          {validationErrors.length === 20 ? <p>只顯示首 20 項錯誤。</p> : null}
        </div>
      ) : null}

      {preview ? (
        <div className={styles.preview}>
          <div className={styles.previewHeader}>
            <div>
              <p className={styles.previewTitle}>✓ Schema 驗證通過</p>
              <p className={styles.previewMeta}>檔案：{preview.fileName}</p>
              <p className={styles.previewMeta}>備份日期：{formatBackupDate(preview.backup.exportedAt)}</p>
              <p className={styles.previewMeta}>項目總數：{countFinanceBackupItems(preview.backup)}</p>
              {preview.backup.userEmail ? <p className={styles.previewMeta}>來源帳號：{preview.backup.userEmail}</p> : null}
            </div>
            <span className={styles.changeBadge}>{changedItems} 項差異</span>
          </div>
          {preview.backup.userEmail && preview.backup.userEmail !== userEmail ? (
            <p className={styles.accountWarning}>注意：備份來源帳號與目前登入帳號不同，請確認這是預期的備份。</p>
          ) : null}
          <div className={styles.tableWrap}>
            <table className={styles.diffTable}>
              <thead>
                <tr><th>資料</th><th>備份</th><th>目前</th><th>新增</th><th>更新</th><th>移除</th></tr>
              </thead>
              <tbody>
                {preview.diff.map(row => (
                  <tr key={row.key}>
                    <td>{row.label}</td><td>{row.backupCount}</td><td>{row.currentCount}</td>
                    <td className={styles.added}>+{row.added}</td>
                    <td className={styles.updated}>~{row.updated}</td>
                    <td className={styles.removed}>-{row.removed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.restoreNote}>Restore 採完整取代：備份中沒有的現有項目會被移除。執行前會下載一份 `finance-pre-restore` 現況備份。</p>
          {subscriptionsProcessing ? <p className={styles.waiting}>正在完成訂閱自動入帳，完成後才可還原。</p> : null}
          {restoreError ? <p className={styles.restoreError} role="alert">{restoreError}</p> : null}
          <button
            className={styles.restoreBtn}
            disabled={restoring || subscriptionsProcessing}
            onClick={() => void executeRestore()}
          >
            {restoring ? '正在備份現況並還原…' : '確認差異並執行還原'}
          </button>
        </div>
      ) : null}
    </Card>
  );
}
