import {PropsWithChildren} from 'react';
import styles from './Screen.module.css';

type Props = PropsWithChildren<{
  title: string;
  subtitle?: string;
}>;

export function Screen({title, subtitle, children}: Props) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}
