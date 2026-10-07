import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Save } from 'lucide-react';
import api from '../../lib/api';
import { apiError } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { PageHeader, Card, Field, Alert, Spinner } from '../../components/ui';

export function ChangePasswordPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.newPassword !== form.confirm) {
      setError('Konfirmasi password baru tidak cocok.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/account/password', { oldPassword: form.oldPassword, newPassword: form.newPassword });
      // The server ends every session after a password change
      await logout().catch(() => {});
      navigate('/login?changed=1', { replace: true });
    } catch (err) {
      setError(apiError(err, 'Gagal mengubah password.'));
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader title="Ganti Password" subtitle="Setelah diganti, Anda akan keluar dari semua perangkat." />

      <form onSubmit={submit} style={{ maxWidth: 520 }}>
        <Card
          title="Password Akun"
          icon={<KeyRound size={16} />}
          footer={
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <Spinner /> : <Save size={16} />}
              Ubah Password
            </button>
          }
        >
          {error && <Alert type="error">{error}</Alert>}
          <Field label="Password Lama" htmlFor="old-password">
            <input id="old-password" type="password" value={form.oldPassword} onChange={set('oldPassword')} required autoComplete="current-password" />
          </Field>
          <Field label="Password Baru" htmlFor="new-password" hint="Minimal 8 karakter.">
            <input id="new-password" type="password" value={form.newPassword} onChange={set('newPassword')} required minLength={8} autoComplete="new-password" />
          </Field>
          <Field label="Konfirmasi Password Baru" htmlFor="confirm-password">
            <input id="confirm-password" type="password" value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" />
          </Field>
        </Card>
      </form>
    </>
  );
}
