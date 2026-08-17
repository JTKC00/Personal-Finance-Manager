import {useMemo, useState} from 'react';
import {
  PAYMENT_INSTRUMENT_TYPE_LABELS,
  PAYMENT_INSTRUMENT_TYPES,
  formatInstrumentLabel,
  instrumentNeedsSecondLayer,
  validateLast4,
} from '../services/paymentInstrument';
import type {Account, PaymentInstrument, PaymentInstrumentType} from '../types/finance';
import styles from './IdentityFields.module.css';

type Props = {
  instruments: PaymentInstrument[];
  accounts: Account[];
  type: PaymentInstrumentType | '';
  instrumentId?: string;
  onChange: (next: {type: PaymentInstrumentType | ''; instrumentId?: string}) => void;
  onCreate: (instrument: PaymentInstrument) => Promise<void> | void;
};

export function PaymentInstrumentField({instruments, accounts, type, instrumentId, onChange, onCreate}: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [last4, setLast4] = useState('');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState('');

  const selectedType = type || undefined;
  const visible = useMemo(() => {
    if (!selectedType) return [];
    return instruments.filter(item => item.type === selectedType && (item.active || item.id === instrumentId));
  }, [instrumentId, instruments, selectedType]);

  const showSecondLayer = selectedType ? instrumentNeedsSecondLayer(selectedType) || visible.length > 0 : false;

  async function createInstrument() {
    if (!selectedType) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('請輸入付款工具名稱');
      return;
    }
    const last4Result = validateLast4(last4);
    if (!last4Result.ok) {
      setError(last4Result.error);
      return;
    }
    const instrument: PaymentInstrument = {
      id: `pay-${Date.now()}`,
      name: trimmed,
      type: selectedType,
      last4: last4Result.last4,
      accountId: accountId || undefined,
      active: true,
      createdAt: new Date().toISOString(),
    };
    await onCreate(instrument);
    onChange({type: selectedType, instrumentId: instrument.id});
    setCreating(false);
    setName('');
    setLast4('');
    setAccountId('');
    setError('');
  }

  return (
    <div className={styles.field}>
      <div className={styles.chips}>
        <button
          type="button"
          className={[styles.chip, !selectedType ? styles.activeChip : ''].join(' ')}
          onClick={() => {
            setCreating(false);
            onChange({type: '', instrumentId: undefined});
          }}
        >
          未指定
        </button>
        {PAYMENT_INSTRUMENT_TYPES.map(item => (
          <button
            key={item}
            type="button"
            className={[styles.chip, selectedType === item ? styles.activeChip : ''].join(' ')}
            onClick={() => {
              setCreating(false);
              onChange({type: item, instrumentId: undefined});
            }}
          >
            {PAYMENT_INSTRUMENT_TYPE_LABELS[item]}
          </button>
        ))}
      </div>

      {showSecondLayer && selectedType ? (
        <>
          <div className={styles.chips}>
            {visible.map(item => (
              <button
                key={item.id}
                type="button"
                className={[styles.chip, instrumentId === item.id ? styles.activeChip : ''].join(' ')}
                onClick={() => onChange({type: selectedType, instrumentId: item.id})}
              >
                {formatInstrumentLabel(item)}{item.active ? '' : '（已停用）'}
              </button>
            ))}
            <button
              type="button"
              className={styles.chip}
              onClick={() => setCreating(true)}
            >
              新增
            </button>
          </div>
          {creating ? (
            <div className={styles.createBox}>
              <input
                className={styles.input}
                placeholder={`${PAYMENT_INSTRUMENT_TYPE_LABELS[selectedType]}名稱，例如 HSBC Red Card`}
                value={name}
                onChange={event => setName(event.target.value)}
              />
              {selectedType === 'credit_card' || selectedType === 'debit_card' ? (
                <input
                  className={styles.input}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="最後 4 位（選填，不要輸入完整卡號）"
                  value={last4}
                  onChange={event => setLast4(event.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              ) : null}
              {accounts.length > 0 ? (
                <select
                  className={styles.input}
                  value={accountId}
                  onChange={event => setAccountId(event.target.value)}
                >
                  <option value="">不連結帳戶</option>
                  {accounts.map(account => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              ) : null}
              {error ? <p className={styles.error}>{error}</p> : null}
              <div className={styles.promptActions}>
                <button type="button" className={styles.promptPrimary} onClick={createInstrument}>儲存此付款工具</button>
                <button type="button" className={styles.promptSecondary} onClick={() => setCreating(false)}>取消</button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
