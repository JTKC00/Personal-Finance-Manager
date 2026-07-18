import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {daysSinceBackup, getLastBackupAt, isBackupOverdue, markBackupDone} from './backupReminder';

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
  };
}

describe('backupReminder', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {localStorage: createLocalStorageStub()});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('treats a missing timestamp as never backed up and overdue', () => {
    expect(getLastBackupAt()).toBeNull();
    expect(daysSinceBackup(null)).toBeNull();
    expect(isBackupOverdue(null)).toBe(true);
  });

  it('round-trips the backup timestamp through localStorage', () => {
    markBackupDone('2026-07-12T10:00:00.000Z');
    expect(getLastBackupAt()).toBe('2026-07-12T10:00:00.000Z');
  });

  it('is not overdue at exactly 30 days and overdue at 31 days', () => {
    const now = new Date('2026-07-31T12:00:00.000Z');
    const thirtyDaysAgo = new Date('2026-07-01T12:00:00.000Z').toISOString();
    const thirtyOneDaysAgo = new Date('2026-06-30T12:00:00.000Z').toISOString();

    expect(daysSinceBackup(thirtyDaysAgo, now)).toBe(30);
    expect(isBackupOverdue(thirtyDaysAgo, now)).toBe(false);
    expect(daysSinceBackup(thirtyOneDaysAgo, now)).toBe(31);
    expect(isBackupOverdue(thirtyOneDaysAgo, now)).toBe(true);
  });

  it('treats an unparsable stored value as never backed up', () => {
    markBackupDone('not-a-date');
    expect(daysSinceBackup(getLastBackupAt())).toBeNull();
    expect(isBackupOverdue(getLastBackupAt())).toBe(true);
  });
});
