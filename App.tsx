import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import {DashboardScreen} from './src/screens/DashboardScreen';
import {AnalysisScreen} from './src/screens/AnalysisScreen';
import {TransactionScreen} from './src/screens/TransactionScreen';
import {GoalsScreen} from './src/screens/GoalsScreen';
import {ProfileScreen} from './src/screens/ProfileScreen';
import {LoginScreen} from './src/screens/LoginScreen';
import {AuthProvider, useAuth} from './src/contexts/AuthContext';
import {BottomNav} from './src/components/BottomNav';

function AppShell() {
  const {user, loading} = useAuth();

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
        <Route path="/goals" element={<GoalsScreen />} />
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
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  );
}


