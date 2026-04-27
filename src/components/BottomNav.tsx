import {NavLink} from 'react-router-dom';
import {Home, List, PlusCircle, Flag, User} from 'lucide-react';
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
    <nav className={styles.nav}>
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
    </nav>
  );
}
