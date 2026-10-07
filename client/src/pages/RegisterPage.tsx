import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import api from '../lib/api';
import { apiError } from '../lib/format';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Field, Spinner } from '../components/ui';

export function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [globalError, setGlobalError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setGlobalError('');
    if (form.password !== form.confirmPassword) {
      setErrors({ confirmPassword: ['Password tidak cocok.'] });
      return;
    }
    setLoading(true);
    try {
      await api.post('/register', form);
      navigate('/login?registered=1');
    } catch (err) {
      const data = (err as { response?: { data?: { errors?: Record<string, string[]> } } }).response?.data;
      if (data?.errors) setErrors(data.errors);
      else setGlobalError(apiError(err, 'Pendaftaran gagal.'));
      setLoading(false);
    }
  };

  const err = (field: string) => errors[field]?.[0];

  return (
    <AuthLayout>
      <h1>Buat akun</h1>
      <p className="auth-sub">Gratis. Hubungkan bot Anda setelah mendaftar.</p>

      {globalError && <Alert type="error">{globalError}</Alert>}

      <form onSubmit={handleSubmit}>
        <div className="field-row">
          <Field label="Username" htmlFor="reg-username" error={err('username')} hint="3–20 huruf, angka, atau _">
            <input
              id="reg-username"
              type="text"
              placeholder="johndoe"
              value={form.username}
              onChange={set('username')}
              required
              minLength={3}
              maxLength={20}
              pattern="^[a-zA-Z0-9_]+$"
              autoComplete="username"
            />
          </Field>
          <Field label="Email" htmlFor="reg-email" error={err('email')}>
            <input id="reg-email" type="email" placeholder="email@contoh.com" value={form.email} onChange={set('email')} required autoComplete="email" />
          </Field>
        </div>
        <Field label="Password" htmlFor="reg-password" error={err('password')} hint="Minimal 8 karakter.">
          <input id="reg-password" type="password" value={form.password} onChange={set('password')} required minLength={8} autoComplete="new-password" />
        </Field>
        <Field label="Konfirmasi Password" htmlFor="reg-confirm" error={err('confirmPassword')}>
          <input id="reg-confirm" type="password" value={form.confirmPassword} onChange={set('confirmPassword')} required autoComplete="new-password" />
        </Field>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={loading} style={{ marginTop: 8 }}>
          {loading ? <Spinner /> : <UserPlus size={18} />}
          Daftar
        </button>
      </form>

      <p className="auth-foot">
        Sudah punya akun? <Link to="/login">Masuk di sini</Link>
      </p>
    </AuthLayout>
  );
}
