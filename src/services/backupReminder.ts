// Tracks when the user last completed a full JSON backup (ProfileScreen's
// exportJsonBackup). Stored per device in localStorage — the downloaded backup
// file lives on that device, so per-device reminders are the honest scope.
// Pure helpers take an injectable `now` so the date math is unit-testable.

const LAST_BACKUP_KEY = 'pfm-last-backup-at';
const OVERDUE_AFTER_DAYS = 30;
const MS_PER_DAY = 86_400_000;

/** Whole days elapsed since the given ISO timestamp; null when absent or unparsable. */
export function daysSinceBackup(lastIso: string | null, now: Date = new Date()): number | null {
  if (!lastIso) return null;
  const last = new Date(lastIso).getTime();
  if (!Number.isFinite(last)) return null;
  return Math.floor((now.getTime() - last) / MS_PER_DAY);
}

/** True when no valid backup timestamp exists or the last backup is older than 30 days. */
export function isBackupOverdue(lastIso: string | null, now: Date = new Date()): boolean {
  const days = daysSinceBackup(lastIso, now);
  return days === null || days > OVERDUE_AFTER_DAYS;
}

export function getLastBackupAt(): string | null {
  return window.localStorage.getItem(LAST_BACKUP_KEY);
}

export function markBackupDone(atIso: string = new Date().toISOString()): void {
  window.localStorage.setItem(LAST_BACKUP_KEY, atIso);
}
