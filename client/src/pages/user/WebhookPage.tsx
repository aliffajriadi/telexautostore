import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Webhook, RefreshCw, Clock } from 'lucide-react';
import api from '../../lib/api';
import { useDashboard } from '../../lib/useDashboard';
import { apiError, formatDateTime, timeAgo } from '../../lib/format';
import { useToast } from '../../contexts/ToastContext';
import { PageHeader, Card, Field, LoadingBlock, CopyField, ConfirmModal, EmptyState, Badge } from '../../components/ui';

export function WebhookPage() {
  const { data, loading, reload } = useDashboard();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  if (loading || !data) return <LoadingBlock />;
  const intg = data.integration;

  if (!intg) {
    return (
      <>
        <PageHeader title="Callback & Webhook" />
        <div className="card">
          <EmptyState
            icon={<Webhook size={22} />}
            title="Belum ada integrasi"
            description="Callback URL dibuat otomatis setelah bot terhubung."
            action={<Link to="/dashboard/integration" className="btn btn-primary">Hubungkan Bot</Link>}
          />
        </div>
      </>
    );
  }

  const regenerate = async () => {
    setRegenerating(true);
    try {
      await api.post('/dashboard/integration/regenerate-callback');
      toast('success', 'Callback URL & secret baru dibuat. Perbarui juga di AutoStore.');
      await reload();
    } catch (err) {
      toast('error', apiError(err, 'Gagal regenerate.'));
    } finally {
      setRegenerating(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <PageHeader title="Callback & Webhook" subtitle="AutoStore memakai URL ini untuk memberi tahu pembayaran yang berhasil." />

      <div className="grid-main-side">
        <Card
          title="Kredensial Callback"
          description="Salin ke pengaturan webhook di AutoStore"
          icon={<Webhook size={16} />}
          footer={
            <button className="btn btn-danger" onClick={() => setConfirming(true)}>
              <RefreshCw size={16} />
              Regenerate
            </button>
          }
        >
          <Field label="Callback URL">
            <CopyField value={intg.callbackUrl} label="Callback URL" />
          </Field>
          <Field label="Webhook Secret" hint="Dipakai untuk memverifikasi tanda tangan HMAC SHA-256 setiap callback.">
            <CopyField value={intg.webhookSecret} label="Webhook Secret" />
          </Field>
        </Card>

        <div className="stack">
          <Card title="Status" icon={<Clock size={16} />}>
            <dl className="dl">
              <dt>Callback terakhir</dt>
              <dd>
                {intg.lastCallbackAt ? (
                  <span title={formatDateTime(intg.lastCallbackAt)}>{timeAgo(intg.lastCallbackAt)}</span>
                ) : (
                  <Badge tone="warning">Belum pernah</Badge>
                )}
              </dd>
            </dl>
          </Card>
          <Card title="Cara Memasang">
            <ol className="text-sm" style={{ paddingLeft: 18, color: 'var(--text-300)', display: 'grid', gap: 8 }}>
              <li>Buka pengaturan integrasi / webhook di panel AutoStore.</li>
              <li>Tempel <strong>Callback URL</strong> dan <strong>Webhook Secret</strong> di atas.</li>
              <li>Lakukan satu transaksi uji. Status di samping akan berubah setelah callback pertama diterima.</li>
            </ol>
          </Card>
        </div>
      </div>

      {confirming && (
        <ConfirmModal
          title="Regenerate callback?"
          description="URL dan secret lama langsung tidak berlaku. Callback dari AutoStore akan ditolak sampai Anda memperbarui pengaturannya di sana."
          confirmLabel="Ya, regenerate"
          danger
          loading={regenerating}
          onConfirm={regenerate}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
