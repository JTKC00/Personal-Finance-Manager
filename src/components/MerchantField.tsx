import {useMemo, useState} from 'react';
import {findMerchantMatches} from '../services/merchantIdentity';
import type {Merchant} from '../types/finance';
import styles from './IdentityFields.module.css';

type Props = {
  merchants: Merchant[];
  text: string;
  merchantId?: string;
  createNew: boolean;
  onChange: (next: {text: string; merchantId?: string; createNew: boolean}) => void;
};

export function MerchantField({merchants, text, merchantId, createNew, onChange}: Props) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => findMerchantMatches(text, merchants).slice(0, 6), [merchants, text]);
  const selected = merchants.find(item => item.id === merchantId);
  const suggestion = !merchantId && !createNew ? matches.find(item => item.confidence !== 'high') : undefined;
  const exact = !merchantId && !createNew ? matches.find(item => item.confidence === 'high') : undefined;

  function choose(merchant: Merchant) {
    onChange({text: text || merchant.name, merchantId: merchant.id, createNew: false});
    setOpen(false);
  }

  return (
    <div className={styles.field}>
      <input
        type="text"
        placeholder="商戶名稱"
        className={styles.input}
        value={text}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={event => {
          const next = event.target.value;
          onChange({text: next, merchantId: undefined, createNew: false});
          setOpen(true);
        }}
      />
      {selected ? (
        <p className={styles.hint}>已配對：{selected.name}{selected.aliases.length ? ` · 曾使用 ${selected.aliases.join('、')}` : ''}</p>
      ) : exact ? (
        <p className={styles.hint}>將配對現有商戶「{exact.merchant.name}」</p>
      ) : createNew && text.trim() ? (
        <p className={styles.hint}>將建立新商戶「{text.trim()}」</p>
      ) : null}

      {suggestion ? (
        <div className={styles.prompt}>
          <p className={styles.promptTitle}>這可能是「{suggestion.merchant.name}」</p>
          {suggestion.merchant.aliases.length ? (
            <p className={styles.promptMeta}>曾使用：{suggestion.merchant.aliases.join('、')}</p>
          ) : null}
          <div className={styles.promptActions}>
            <button type="button" className={styles.promptPrimary} onClick={() => choose(suggestion.merchant)}>
              使用「{suggestion.merchant.name}」
            </button>
            <button
              type="button"
              className={styles.promptSecondary}
              onClick={() => onChange({text, merchantId: undefined, createNew: true})}
            >
              確定建立新商戶
            </button>
          </div>
        </div>
      ) : null}

      {open && matches.length > 0 ? (
        <div className={styles.list}>
          {matches.map(item => (
            <button
              key={item.merchant.id}
              type="button"
              className={styles.listItem}
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(item.merchant)}
            >
              <span>{item.merchant.name}</span>
              <span className={styles.listMeta}>
                {item.confidence === 'high' ? '完全相符' : `曾用 ${item.matchedOn}`}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
