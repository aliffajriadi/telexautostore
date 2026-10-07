import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/AppLayout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { OverviewPage } from './pages/user/OverviewPage';
import { IntegrationPage } from './pages/user/IntegrationPage';
import { WebhookPage } from './pages/user/WebhookPage';
import { AppearancePage } from './pages/user/AppearancePage';
import { OrdersPage } from './pages/user/OrdersPage';
import { ChangePasswordPage } from './pages/user/ChangePasswordPage';
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage';
import { UsersPage } from './pages/admin/UsersPage';
import { UserDetailPage } from './pages/admin/UserDetailPage';
import { AuditPage } from './pages/admin/AuditPage';

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><Spinner large /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'ADMIN' ? '/admin' : '/dashboard'} replace />;
}

/** Sends already-logged-in users away from login/register. */
function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><Spinner large /></div>;
  if (user) return <Navigate to={user.role === 'ADMIN' ? '/admin' : '/dashboard'} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
            <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />

            <Route element={<ProtectedRoute><AppLayout variant="user" /></ProtectedRoute>}>
              <Route path="/dashboard" element={<OverviewPage />} />
              <Route path="/dashboard/integration" element={<IntegrationPage />} />
              <Route path="/dashboard/webhook" element={<WebhookPage />} />
              <Route path="/dashboard/appearance" element={<AppearancePage />} />
              <Route path="/dashboard/orders" element={<OrdersPage />} />
              <Route path="/account/password" element={<ChangePasswordPage />} />
            </Route>

            <Route element={<ProtectedRoute adminOnly><AppLayout variant="admin" /></ProtectedRoute>}>
              <Route path="/admin" element={<AdminOverviewPage />} />
              <Route path="/admin/users" element={<UsersPage />} />
              <Route path="/admin/users/:id" element={<UserDetailPage />} />
              <Route path="/admin/audit" element={<AuditPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
