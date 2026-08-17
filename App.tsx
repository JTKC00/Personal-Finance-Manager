import {lazy, Suspense} from 'react';
import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import {useRegisterSW} from 'virtual:pwa-register/react';
import {AuthProvider, useAuth} from './src/contexts/AuthContext';
import {SubscriptionProcessingProvider} from './src/contexts/SubscriptionProcessingContext';
import {BottomNav} from './src/components/BottomNav';

const DashboardScreen = lazy(() => import('./src/screens/DashboardScreen').then(module => ({default: module.DashboardScreen})));
const AnalysisScreen = lazy(() => import('./src/screens/AnalysisScreen').then(module => ({default: module.AnalysisScreen})));
const TransactionScreen = lazy(() => import('./src/screens/TransactionScreen').then(module => ({default: module.TransactionScreen})));
const TransactionListScreen = lazy(() => import('./src/screens/TransactionListScreen').then(module => ({default: module.TransactionListScreen})));
const GoalsScreen = lazy(() => import('./src/screens/GoalsScreen').then(module => ({default: module.GoalsScreen})));
const SubscriptionsScreen = lazy(() => import('./src/screens/SubscriptionsScreen').then(module => ({default: module.SubscriptionsScreen})));
const ProfileScreen = lazy(() => import('./src/screens/ProfileScreen').then(module => ({default: module.ProfileScreen})));
const DirectoryScreen = lazy(() => import('./src/screens/DirectoryScreen').then(module => ({default: module.DirectoryScreen})));
const LoginScreen = lazy(() => import('./src/screens/LoginScreen').then(module => ({default: module.LoginScreen})));

function LoadingScreen() {
  return (
    <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--color-bg)'}}>
      <div style={{width: 32, height: 32, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-text)', borderRadius: '50%', animation: 'spin 0.8s linear infinite'}} />
    </div>
  );
}

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

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <LoginScreen />
      </Suspense>
    );
  }

  return (
    <SubscriptionProcessingProvider key={user.uid}>
      <div style={{minHeight: '100vh', overflowY: 'auto', background: 'var(--color-bg)'}}>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardScreen />} />
            <Route path="/analysis" element={<AnalysisScreen />} />
            <Route path="/transaction" element={<TransactionScreen />} />
            <Route path="/transactions" element={<TransactionListScreen />} />
            <Route path="/goals" element={<GoalsScreen />} />
            <Route path="/subscriptions" element={<SubscriptionsScreen />} />
            <Route path="/profile" element={<ProfileScreen />} />
            <Route path="/directory" element={<DirectoryScreen />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
        <BottomNav />
      </div>
    </SubscriptionProcessingProvider>
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
