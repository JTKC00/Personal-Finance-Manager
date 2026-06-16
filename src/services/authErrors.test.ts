import {describe, expect, it} from 'vitest';
import {isAuthFlowCancelled, translateFirebaseAuthError} from './authErrors';

describe('translateFirebaseAuthError', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['auth/user-not-found', '電郵或密碼不正確，請再試。'],
    ['auth/wrong-password', '電郵或密碼不正確，請再試。'],
    ['auth/invalid-credential', '電郵或密碼不正確，請再試。'],
    ['auth/email-already-in-use', '此電郵已被使用，請直接登入。'],
    ['auth/weak-password', '密碼太弱，請使用至少 8 個字元，並包含大小寫英文字母及數字。'],
    ['auth/invalid-email', '電郵格式不正確。'],
    ['auth/missing-email', '請輸入電郵地址。'],
    ['auth/too-many-requests', '操作太頻繁，請稍後再試。'],
    ['auth/user-disabled', '此帳戶已被停用，請聯絡管理員。'],
    ['auth/popup-blocked', '瀏覽器阻擋了 Google 登入視窗，系統已改用頁面跳轉登入。'],
    ['auth/popup-closed-by-user', '你已取消 Google 登入。'],
    ['auth/cancelled-popup-request', '你已取消 Google 登入。'],
    ['auth/operation-not-supported-in-this-environment', '此環境不支援 Google 彈出式登入，系統會改用頁面跳轉登入。'],
    ['auth/web-storage-unsupported', '此環境不支援 Google 彈出式登入，系統會改用頁面跳轉登入。'],
    ['auth/unauthorized-domain', '這個網站網域未被 Firebase Authentication 授權。請到 Firebase Console > Authentication > Settings > Authorized domains，把目前網站網域加入。'],
    ['auth/account-exists-with-different-credential', '此電郵已用其他登入方式註冊，請先用原本方式登入後再綁定 Google。'],
    ['auth/operation-not-allowed', 'Firebase Authentication 尚未啟用這個登入方式。請確認已啟用 Email/Password 或 Google 登入。'],
    ['auth/credential-already-in-use', '此 Google 帳號已被其他帳戶使用。'],
    ['auth/network-request-failed', '網絡連線失敗，請檢查網絡。'],
  ];

  for (const [code, expected] of cases) {
    it(`maps ${code} to its localized message`, () => {
      expect(translateFirebaseAuthError(`Firebase: Error (${code}).`)).toBe(expected);
    });
  }

  it('returns the original message when the code is unrecognized', () => {
    const message = 'Firebase: Error (auth/internal-error).';
    expect(translateFirebaseAuthError(message)).toBe(message);
  });
});

describe('isAuthFlowCancelled', () => {
  it('is true when the user closes or cancels the popup', () => {
    expect(isAuthFlowCancelled('auth/popup-closed-by-user')).toBe(true);
    expect(isAuthFlowCancelled('auth/cancelled-popup-request')).toBe(true);
  });

  it('is false for other errors', () => {
    expect(isAuthFlowCancelled('auth/wrong-password')).toBe(false);
    expect(isAuthFlowCancelled('')).toBe(false);
  });
});
