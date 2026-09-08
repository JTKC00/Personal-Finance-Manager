import {PropsWithChildren} from 'react';
import styles from './Screen.module.css';

type Props = PropsWithChildren<{
  title: string;
  subtitle?: string;
  wide?: boolean;
}>;

export function Screen({title, subtitle, wide, children}: Props) {
  return (
    <div className={[styles.container, wide ? styles.wide : ''].join(' ')}>
      <div className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}
