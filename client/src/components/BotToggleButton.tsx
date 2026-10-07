import React, { useState } from 'react';
import { Power } from 'lucide-react';
import api from '../lib/api';
import { apiError } from '../lib/format';
import { useToast } from '../contexts/ToastContext';
import { ConfirmModal, Spinner } from './ui';

export function BotToggleButton({ active, onChanged }: { active: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    setLoading(true);
    try {
      await api.post('/dashboard/bot/toggle');
      toast('success', active ? 'Bot dinonaktifkan.' : 'Bot berhasil diaktifkan!');
      onChanged();
    } catch (err) {
      toast('error', apiError(err, 'Gagal mengubah status bot.'));
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <button className={`btn ${active ? 'btn-danger' : 'btn-primary'}`} onClick={() => setConfirming(true)} disabled={loading}>
        {loading ? <Spinner /> : <Power size={16} />}
        {active ? 'Nonaktifkan Bot' : 'Aktifkan Bot'}
      </button>
      {confirming && (
        <ConfirmModal
          title={active ? 'Nonaktifkan bot?' : 'Aktifkan bot?'}
          description={
            active
              ? 'Bot akan berhenti membalas pembeli. Pesanan yang sudah dibayar tetap dikirim.'
              : 'Webhook Telegram akan didaftarkan dan bot mulai melayani pembeli.'
          }
          confirmLabel={active ? 'Nonaktifkan' : 'Aktifkan'}
          danger={active}
          loading={loading}
          onConfirm={toggle}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
