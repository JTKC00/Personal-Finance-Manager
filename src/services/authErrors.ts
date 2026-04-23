export function translateFirebaseAuthError(msg: string): string {
  if (
    msg.includes('user-not-found') ||
    msg.includes('wrong-password') ||
    msg.includes('invalid-credential')
  ) {
    return '電郵或密碼不正確，請再試。';
  }

  if (msg.includes('email-already-in-use')) {
    return '此電郵已被使用，請直接登入。';
  }

  if (msg.includes('weak-password')) {
    return '密碼太弱，請使用至少 8 個字元，並包含大小寫英文字母及數字。';
  }

  if (msg.includes('invalid-email')) {
    return '電郵格式不正確。';
  }

  if (msg.includes('missing-email')) {
    return '請輸入電郵地址。';
  }

  if (msg.includes('too-many-requests')) {
    return '操作太頻繁，請稍後再試。';
  }

  if (msg.includes('user-disabled')) {
    return '此帳戶已被停用，請聯絡管理員。';
  }

  if (msg.includes('popup-blocked')) {
    return '瀏覽器阻擋了 Google 登入視窗，系統已改用頁面跳轉登入。';
  }

  if (
    msg.includes('popup-closed-by-user') ||
    msg.includes('cancelled-popup-request')
  ) {
    return '你已取消 Google 登入。';
  }

  if (
    msg.includes('operation-not-supported-in-this-environment') ||
    msg.includes('web-storage-unsupported')
  ) {
    return '此環境不支援 Google 彈出式登入，系統會改用頁面跳轉登入。';
  }

  if (msg.includes('unauthorized-domain')) {
    return '這個網站網域未被 Firebase Authentication 授權。請到 Firebase Console > Authentication > Settings > Authorized domains，把目前網站網域加入。';
  }

  if (msg.includes('account-exists-with-different-credential')) {
    return '此電郵已用其他登入方式註冊，請先用原本方式登入後再綁定 Google。';
  }

  if (msg.includes('operation-not-allowed')) {
    return 'Firebase Authentication 尚未啟用這個登入方式。請確認已啟用 Email/Password 或 Google 登入。';
  }

  if (msg.includes('credential-already-in-use') || msg.includes('already-in-use')) {
    return '此 Google 帳號已被其他帳戶使用。';
  }

  if (msg.includes('network-request-failed')) {
    return '網絡連線失敗，請檢查網絡。';
  }

  return msg;
}

export function isAuthFlowCancelled(msg: string): boolean {
  return (
    msg.includes('popup-closed-by-user') ||
    msg.includes('cancelled-popup-request')
  );
}
