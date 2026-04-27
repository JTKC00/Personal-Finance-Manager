import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import {useRegisterSW} from 'virtual:pwa-register/react';
import {DashboardScreen} from './src/screens/DashboardScreen';
import {AnalysisScreen} from './src/screens/AnalysisScreen';
import {TransactionScreen} from './src/screens/TransactionScreen';
import {TransactionListScreen} from './src/screens/TransactionListScreen';
import {GoalsScreen} from './src/screens/GoalsScreen';
import {SubscriptionsScreen} from './src/screens/SubscriptionsScreen';
import {ProfileScreen} from './src/screens/ProfileScreen';
import {LoginScreen} from './src/screens/LoginScreen';
import {AuthProvider, useAuth} from './src/contexts/AuthContext';
import {BottomNav} from './src/components/BottomNav';
import {processDueSubscriptions} from './src/services/storage';
import {useEffect} from 'react';

function UpdateBanner() {
  const {needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker} = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'var(--color-primary)', color: '#fff',
      padding: '10px 16px', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: 8, fontSize: 14,
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    }}>
      <span>🎉 App 有新版本！</span>
      <div style={{display: 'flex', gap: 8}}>
        <button
          onClick={() => updateServiceWorker(true)}
          style={{padding: '4px 14px', background: '#fff', color: 'var(--color-primary)', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13}}
        >立即更新</button>
        <button
          onClick={() => setNeedRefresh(false)}
          style={{padding: '4px 10px', background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.5)', borderRadius: 6, cursor: 'pointer', fontSize: 13}}
        >稍後</button>
      </div>
    </div>
  );
}

function AppShell() {
  const {user, loading} = useAuth();

  useEffect(() => {
    if (user) {
      processDueSubscriptions().catch(() => undefined);
    }
  }, [user]);

  if (loading) {
    return (
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--color-bg)'}}>
        <div style={{width: 32, height: 32, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-text)', borderRadius: '50%', animation: 'spin 0.8s linear infinite'}} />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div style={{minHeight: '100vh', overflowY: 'auto', background: 'var(--color-bg)'}}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardScreen />} />
        <Route path="/analysis" element={<AnalysisScreen />} />
        <Route path="/transaction" element={<TransactionScreen />} />
        <Route path="/transactions" element={<TransactionListScreen />} />
        <Route path="/goals" element={<GoalsScreen />} />
        <Route path="/subscriptions" element={<SubscriptionsScreen />} />
        <Route path="/profile" element={<ProfileScreen />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <UpdateBanner />
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  );
}
