import {NavLink} from 'react-router-dom';
import {Home, BarChart2, PlusCircle, List, Flag, User} from 'lucide-react';
import styles from './BottomNav.module.css';

const tabs = [
  {to: '/dashboard', label: '首頁', Icon: Home},
  {to: '/analysis', label: '分析', Icon: BarChart2},
  {to: '/transaction', label: '記帳', Icon: PlusCircle},
  {to: '/transactions', label: '交易', Icon: List},
  {to: '/goals', label: '目標', Icon: Flag},
  {to: '/profile', label: '我的帳戶', Icon: User},
];

export function BottomNav() {
  return (
    <nav className={styles.nav}>
      {tabs.map(({to, label, Icon}) => (
        <NavLink
          key={to}
          to={to}
          className={({isActive}) =>
            [styles.item, isActive ? styles.active : ''].join(' ')
          }
        >
          <Icon size={22} strokeWidth={1.5} />
          <span className={styles.label}>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
