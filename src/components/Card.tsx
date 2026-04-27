import {PropsWithChildren} from 'react';
import styles from './Card.module.css';

type Props = PropsWithChildren<{
  title?: string;
  flat?: boolean;
  action?: {label: string; onClick: () => void};
}>;

export function Card({title, flat, action, children}: Props) {
  return (
    <div className={[styles.card, flat ? styles.flat : ''].join(' ')}>
      {(title || action) ? (
        <div className={styles.header}>
          {title ? <p className={styles.title}>{title}</p> : null}
          {action ? (
            <button className={styles.actionBtn} onClick={action.onClick}>
              {action.label}
            </button>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
