import {PropsWithChildren} from 'react';
import styles from './Card.module.css';

type Props = PropsWithChildren<{
  title?: string;
}>;

export function Card({title, children}: Props) {
  return (
    <div className={styles.card}>
      {title ? <p className={styles.title}>{title}</p> : null}
      {children}
    </div>
  );
}
