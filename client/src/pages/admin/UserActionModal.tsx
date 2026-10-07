import React, { useState } from 'react';
import api from '../../lib/api';
import { apiError } from '../../lib/format';
import { useToast } from '../../contexts/ToastContext';
import { Modal, Field, Spinner, Alert, CopyField } from '../../components/ui';

export type UserAction = 'blacklist' | 'unblacklist' | 'reset-password';

const TITLES: Record<UserAction, string> = {
  blacklist: 'Blacklist pengguna',
  unblacklist: 'Pulihkan pengguna',
  'reset-password': 'Reset password',
};

const DESCRIPTIONS: Record<UserAction, string> = {
  blacklist: 'Pengguna tidak bisa login, semua sesinya dihapus, dan botnya dinonaktifkan. Pesanan yang sudah dibayar tetap dikirim.',
  unblacklist: 'Pengguna bisa login kembali. Bot perlu diaktifkan ulang oleh pemiliknya.',
  'reset-password': 'Semua sesi pengguna akan dihapus. Kosongkan kolom untuk membuat password acak.',
};

export function UserActionModal({ user, action, onClose, onDone }: {
  user: { id: number; username: string };
  action: UserAction;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (action === 'reset-password') {
        const res = await api.post(`/admin/users/${user.id}/reset-password`, { newPassword: newPassword || undefined });
        onDone();
        if (res.data.generatedPassword) {
          // Keep the dialog open: the generated password is shown only once
          setGenerated(res.data.generatedPassword);
          setLoading(false);
          return;
        }
        toast('success', `Password @${user.username} berhasil direset.`);
      } else {
        await api.post(`/admin/users/${user.id}/${action}`, { reason: reason || undefined });
        toast('success', action === 'blacklist' ? `@${user.username} di-blacklist.` : `@${user.username} dipulihkan.`);
        onDone();
      }
      onClose();
    } catch (err) {
      setError(apiError(err, 'Aksi gagal.'));
      setLoading(false);
    }
  };

  if (generated) {
    return (
      <Modal
        title="Password baru dibuat"
        description={`Berikan password ini ke @${user.username}. Password hanya ditampilkan sekali.`}
        onClose={onClose}
        footer={<button className="btn btn-primary" onClick={onClose}>Selesai</button>}
      >
        <CopyField value={generated} label="password" />
      </Modal>
    );
  }

  return (
    <Modal title={`${TITLES[action]} @${user.username}`} description={DESCRIPTIONS[action]} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <Alert type="error">{error}</Alert>}
        {action === 'reset-password' ? (
          <Field label="Password baru (opsional)" htmlFor="new-pass" hint="Minimal 8 karakter.">
            <input id="new-pass" type="text" autoComplete="off" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} placeholder="Kosongkan untuk generate otomatis" />
          </Field>
        ) : (
          <Field label="Alasan (opsional)" htmlFor="reason" hint="Tercatat di audit log.">
            <textarea id="reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>Batal</button>
          <button type="submit" className={`btn ${action === 'blacklist' ? 'btn-danger' : 'btn-primary'}`} disabled={loading}>
            {loading && <Spinner />}
            {action === 'blacklist' ? 'Blacklist' : action === 'unblacklist' ? 'Pulihkan' : 'Reset Password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
