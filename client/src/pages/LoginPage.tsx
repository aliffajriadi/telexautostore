import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiError } from '../lib/format';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Field, Spinner } from '../components/ui';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const notice = params.get('registered')
    ? 'Akun berhasil dibuat. Silakan masuk.'
    : params.get('changed')
      ? 'Password berhasil diubah. Silakan masuk kembali.'
      : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = (await login(identifier, password)) as { role?: string };
      navigate(data?.role === 'ADMIN' ? '/admin' : '/dashboard', { replace: true });
    } catch (err) {
      setError(apiError(err, 'Login gagal.'));
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <h1>Selamat datang kembali</h1>
      <p className="auth-sub">Masuk untuk mengelola bot Telegram Anda.</p>

      {notice && !error && <Alert type="success">{notice}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      <form onSubmit={handleSubmit}>
        <Field label="Email atau Username" htmlFor="login-identifier">
          <input
            id="login-identifier"
            type="text"
            placeholder="email@contoh.com"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            autoFocus
            autoComplete="username"
          />
        </Field>
        <Field label="Password" htmlFor="login-password">
          <input
            id="login-password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={loading} style={{ marginTop: 8 }}>
          {loading ? <Spinner /> : <LogIn size={18} />}
          Masuk
        </button>
      </form>

      <p className="auth-foot">
        Belum punya akun? <Link to="/register">Daftar sekarang</Link>
      </p>
    </AuthLayout>
  );
}
