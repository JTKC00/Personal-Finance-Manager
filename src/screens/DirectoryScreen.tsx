import {useCallback, useEffect, useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {addMerchantAlias, suggestDuplicateMerchants} from '../services/merchantIdentity';
import {
  formatInstrumentLabel,
  PAYMENT_INSTRUMENT_TYPE_LABELS,
  PAYMENT_INSTRUMENT_TYPES,
  validateLast4,
} from '../services/paymentInstrument';
import {
  loadAccounts,
  loadMerchants,
  loadPaymentInstruments,
  mergeMerchants,
  upsertMerchant,
  upsertPaymentInstrument,
} from '../services/storage';
import type {Account, Merchant, PaymentInstrument, PaymentInstrumentType} from '../types/finance';
import styles from './DirectoryScreen.module.css';

type Tab = 'merchants' | 'instruments';

export function DirectoryScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('merchants');
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [instruments, setInstruments] = useState<PaymentInstrument[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [toast, setToast] = useState('');
  const [renameId, setRenameId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [newAlias, setNewAlias] = useState<Record<string, string>>({});
  const [instrumentName, setInstrumentName] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const [nextMerchants, nextInstruments, nextAccounts] = await Promise.all([
      loadMerchants(),
      loadPaymentInstruments(),
      loadAccounts(),
    ]);
    setMerchants([...nextMerchants].sort((left, right) => left.name.localeCompare(right.name)));
    setInstruments([...nextInstruments].sort((left, right) => left.name.localeCompare(right.name)));
    setAccounts(nextAccounts);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const suggestions = useMemo(() => suggestDuplicateMerchants(merchants), [merchants]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(''), 2500);
  }

  async function renameMerchant(merchant: Merchant) {
    const name = renameValue.trim();
    if (!name) return;
    await upsertMerchant({...merchant, name});
    setRenameId('');
    await refresh();
    showToast('已更新商戶名稱。');
  }

  async function addAlias(merchant: Merchant) {
    const alias = (newAlias[merchant.id] || '').trim();
    if (!alias) return;
    await upsertMerchant(addMerchantAlias(merchant, alias));
    setNewAlias(current => ({...current, [merchant.id]: ''}));
    await refresh();
    showToast('已加入別名。');
  }

  async function confirmMerge(sourceId: string, targetId: string) {
    const source = merchants.find(item => item.id === sourceId);
    const target = merchants.find(item => item.id === targetId);
    if (!source || !target) return;
    if (!window.confirm(`確定把「${source.name}」合併到「${target.name}」？相關交易會改連到後者，原始輸入文字會保留。`)) return;
    await mergeMerchants(sourceId, targetId);
    setMergeSource('');
    setMergeTarget('');
    await refresh();
    showToast('商戶已合併。');
  }

  async function saveInstrumentName(instrument: PaymentInstrument) {
    const name = (instrumentName[instrument.id] ?? instrument.name).trim();
    if (!name) return;
    await upsertPaymentInstrument({...instrument, name});
    await refresh();
    showToast('已更新付款工具名稱。');
  }

  async function toggleInstrument(instrument: PaymentInstrument) {
    await upsertPaymentInstrument({...instrument, active: !instrument.active});
    await refresh();
  }

  async function createInstrument(type: PaymentInstrumentType, name: string, last4: string, accountId: string) {
    const last4Result = validateLast4(last4);
    if (!last4Result.ok) {
      showToast(last4Result.error);
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      showToast('請輸入付款工具名稱。');
      return;
    }
    await upsertPaymentInstrument({
      id: `pay-${Date.now()}`,
      name: trimmed,
      type,
      last4: last4Result.last4,
      accountId: accountId || undefined,
      active: true,
      createdAt: new Date().toISOString(),
    });
    await refresh();
    showToast('已新增付款工具。');
  }

  return (
    <Screen title="商戶與付款工具" subtitle="管理分析用的正規身份，不會自動合併">
      <button className={styles.backBtn} onClick={() => navigate('/profile')}>‹ 返回設定</button>
      <div className={styles.tabs}>
        <button className={[styles.tab, tab === 'merchants' ? styles.activeTab : ''].join(' ')} onClick={() => setTab('merchants')}>商戶</button>
        <button className={[styles.tab, tab === 'instruments' ? styles.activeTab : ''].join(' ')} onClick={() => setTab('instruments')}>付款工具</button>
      </div>

      {tab === 'merchants' ? (
        <>
          {suggestions.length ? (
            <Card title="疑似重複商戶">
              <p className={styles.body}>系統只建議、不會自行合併。</p>
              {suggestions.map(item => (
                <div key={`${item.leftId}-${item.rightId}`} className={styles.row}>
                  <div>
                    <p className={styles.title}>{item.leftName} 與 {item.rightName}</p>
                    <p className={styles.meta}>{item.reason}</p>
                  </div>
                  <button className={styles.secondaryBtn} onClick={() => confirmMerge(item.leftId, item.rightId)}>
                    合併到「{item.rightName}」
                  </button>
                </div>
              ))}
            </Card>
          ) : null}

          <Card title="手動合併">
            <div className={styles.mergeRow}>
              <select className={styles.input} value={mergeSource} onChange={event => setMergeSource(event.target.value)}>
                <option value="">來源商戶</option>
                {merchants.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <select className={styles.input} value={mergeTarget} onChange={event => setMergeTarget(event.target.value)}>
                <option value="">目標商戶</option>
                {merchants.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            <button
              className={styles.primaryBtn}
              disabled={!mergeSource || !mergeTarget || mergeSource === mergeTarget}
              onClick={() => confirmMerge(mergeSource, mergeTarget)}
            >
              確認合併
            </button>
          </Card>

          <Card title="商戶清單">
            {merchants.length === 0 ? <p className={styles.body}>還沒有正規商戶。記帳時輸入商戶名稱後會建立。</p> : null}
            {merchants.map(merchant => (
              <div key={merchant.id} className={styles.entity}>
                {renameId === merchant.id ? (
                  <div className={styles.inline}>
                    <input className={styles.input} value={renameValue} onChange={event => setRenameValue(event.target.value)} />
                    <button className={styles.secondaryBtn} onClick={() => renameMerchant(merchant)}>儲存</button>
                  </div>
                ) : (
                  <div className={styles.row}>
                    <div>
                      <p className={styles.title}>{merchant.name}</p>
                      <p className={styles.meta}>
                        {merchant.aliases.length ? `別名：${merchant.aliases.join('、')}` : '尚無別名'}
                      </p>
                    </div>
                    <button className={styles.secondaryBtn} onClick={() => { setRenameId(merchant.id); setRenameValue(merchant.name); }}>
                      重新命名
                    </button>
                  </div>
                )}
                <div className={styles.inline}>
                  <input
                    className={styles.input}
                    placeholder="新增別名"
                    value={newAlias[merchant.id] || ''}
                    onChange={event => setNewAlias(current => ({...current, [merchant.id]: event.target.value}))}
                  />
                  <button className={styles.secondaryBtn} onClick={() => addAlias(merchant)}>加入</button>
                </div>
              </div>
            ))}
          </Card>
        </>
      ) : (
        <>
          <CreateInstrumentCard accounts={accounts} onCreate={createInstrument} />
          <Card title="付款工具">
            {instruments.length === 0 ? <p className={styles.body}>還沒有具體付款工具。記帳時可在第二層新增。</p> : null}
            {instruments.map(instrument => (
              <div key={instrument.id} className={styles.entity}>
                <div className={styles.row}>
                  <div>
                    <p className={styles.title}>{formatInstrumentLabel(instrument)}</p>
                    <p className={styles.meta}>
                      {PAYMENT_INSTRUMENT_TYPE_LABELS[instrument.type]}
                      {instrument.accountId ? ` · 連結 ${accounts.find(item => item.id === instrument.accountId)?.name || '帳戶'}` : ' · 未連結帳戶'}
                      {instrument.active ? '' : ' · 已停用'}
                    </p>
                  </div>
                  <button className={styles.secondaryBtn} onClick={() => toggleInstrument(instrument)}>
                    {instrument.active ? '停用' : '重新啟用'}
                  </button>
                </div>
                <div className={styles.inline}>
                  <input
                    className={styles.input}
                    value={instrumentName[instrument.id] ?? instrument.name}
                    onChange={event => setInstrumentName(current => ({...current, [instrument.id]: event.target.value}))}
                  />
                  <button className={styles.secondaryBtn} onClick={() => saveInstrumentName(instrument)}>更新名稱</button>
                </div>
              </div>
            ))}
          </Card>
        </>
      )}
      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </Screen>
  );
}

function CreateInstrumentCard({
  accounts,
  onCreate,
}: {
  accounts: Account[];
  onCreate: (type: PaymentInstrumentType, name: string, last4: string, accountId: string) => Promise<void>;
}) {
  const [type, setType] = useState<PaymentInstrumentType>('credit_card');
  const [name, setName] = useState('');
  const [last4, setLast4] = useState('');
  const [accountId, setAccountId] = useState('');

  return (
    <Card title="新增付款工具">
      <div className={styles.chips}>
        {PAYMENT_INSTRUMENT_TYPES.map(item => (
          <button
            key={item}
            type="button"
            className={[styles.chip, type === item ? styles.activeChip : ''].join(' ')}
            onClick={() => setType(item)}
          >
            {PAYMENT_INSTRUMENT_TYPE_LABELS[item]}
          </button>
        ))}
      </div>
      <input className={styles.input} placeholder="名稱" value={name} onChange={event => setName(event.target.value)} />
      {type === 'credit_card' || type === 'debit_card' ? (
        <input
          className={styles.input}
          inputMode="numeric"
          maxLength={4}
          placeholder="最後 4 位（選填）"
          value={last4}
          onChange={event => setLast4(event.target.value.replace(/\D/g, '').slice(0, 4))}
        />
      ) : null}
      {accounts.length > 0 ? (
        <select className={styles.input} value={accountId} onChange={event => setAccountId(event.target.value)}>
          <option value="">不連結帳戶</option>
          {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
      ) : null}
      <button className={styles.primaryBtn} onClick={() => onCreate(type, name, last4, accountId)}>新增</button>
    </Card>
  );
}
