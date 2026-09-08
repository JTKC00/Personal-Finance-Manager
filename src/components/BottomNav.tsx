import {NavLink} from 'react-router-dom';
import {Home, List, PlusCircle, Flag, User, Wallet, ChartNoAxesCombined, Repeat, BookUser} from 'lucide-react';
import styles from './BottomNav.module.css';

const tabs: {to: string; label: string; Icon: React.ElementType; center?: boolean}[] = [
  {to: '/dashboard', label: '首頁', Icon: Home},
  {to: '/transactions', label: '交易', Icon: List},
  {to: '/transaction', label: '記帳', Icon: PlusCircle, center: true},
  {to: '/goals', label: '目標', Icon: Flag},
  {to: '/profile', label: '我的', Icon: User},
];

export function BottomNav() {
  return (
    <nav className={styles.nav} aria-label="主要導覽">
      <div className={styles.brand}><Wallet size={24} strokeWidth={1.5} /><span>個人財務管家<small>每一筆，心中有數。</small></span></div>
      <span className={styles.navHeading}>日常理財</span>
      {tabs.map(({to, label, Icon, center}) => (
        <NavLink
          key={to}
          to={to}
          className={({isActive}) =>
            [styles.item, isActive ? styles.active : '', center ? styles.centerItem : ''].join(' ')
          }
        >
          {center ? (
            <span className={styles.centerIcon}>
              <Icon size={26} strokeWidth={2} />
            </span>
          ) : (
            <Icon size={22} strokeWidth={1.5} />
          )}
          <span className={styles.label}>{label}</span>
        </NavLink>
      ))}
      <div className={styles.desktopLinks}>
        <span className={styles.navHeading}>管理與分析</span>
        {[
          {to: '/analysis', label: '收支分析', Icon: ChartNoAxesCombined},
          {to: '/subscriptions', label: '訂閱管理', Icon: Repeat},
          {to: '/directory', label: '商戶與付款工具', Icon: BookUser},
        ].map(({to, label, Icon}) => <NavLink key={to} to={to} className={({isActive}) => [styles.item, isActive ? styles.active : ''].join(' ')}><Icon size={20} strokeWidth={1.5} /><span className={styles.label}>{label}</span></NavLink>)}
      </div>
    </nav>
  );
}
