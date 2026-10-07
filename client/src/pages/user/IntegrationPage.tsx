import React, { useState } from 'react';
import { Bot, Store, Save, PlugZap, CircleCheck, CircleX } from 'lucide-react';
import api from '../../lib/api';
import { useDashboard } from '../../lib/useDashboard';
import { apiError } from '../../lib/format';
import { useToast } from '../../contexts/ToastContext';
import { PageHeader, Card, Field, LoadingBlock, Spinner, Badge, Alert } from '../../components/ui';
import { BotToggleButton } from '../../components/BotToggleButton';

interface TestResult { botOk?: boolean; botError?: string; autostoreOk?: boolean; autostoreError?: string }

export function IntegrationPage() {
  const { data, loading, reload } = useDashboard();
  const toast = useToast();
  const [form, setForm] = useState({ botToken: '', autostoreUrl: '', apiKey: '' });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  if (loading || !data) return <LoadingBlock />;
  const intg = data.integration;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    // Only send fields the user filled in: empty means "keep the current value"
    const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
    if (Object.keys(payload).length === 0) {
      toast('error', 'Tidak ada perubahan untuk disimpan.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/dashboard/integration', payload);
      toast('success', intg ? 'Integrasi diperbarui.' : 'Bot berhasil terhubung!');
      setForm({ botToken: '', autostoreUrl: '', apiKey: '' });
      setTestResult(null);
      await reload();
    } catch (err) {
      toast('error', apiError(err, 'Gagal menyimpan integrasi.'));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post<TestResult>('/dashboard/integration/test');
      setTestResult(res.data);
    } catch (err) {
      toast('error', apiError(err, 'Tes koneksi gagal.'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Integrasi"
        subtitle="Hubungkan bot Telegram dengan toko AutoStore Anda."
        actions={intg && <BotToggleButton active={intg.botActive} onChanged={reload} />}
      />

      {!intg && (
        <Alert type="info">
          Buat bot baru lewat <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> di Telegram,
          lalu tempel tokennya di bawah bersama URL AutoStore Anda.
        </Alert>
      )}

      <form onSubmit={save} className="stack">
        <div className="grid-2">
          <Card title="Bot Telegram" description="Token dari @BotFather" icon={<Bot size={16} />}>
            {intg && (
              <div className="row" style={{ marginBottom: 16 }}>
                <Badge tone={intg.botActive ? 'success' : 'neutral'}>{intg.botActive ? 'Aktif' : 'Nonaktif'}</Badge>
                <span className="muted text-sm">@{intg.botUsername}</span>
              </div>
            )}
            <Field
              label="Token Bot"
              htmlFor="bot-token"
              hint={intg ? 'Kosongkan jika tidak ingin mengganti token.' : 'Contoh: 123456789:AAH...'}
            >
              <input
                id="bot-token"
                type="password"
                autoComplete="off"
                placeholder={intg ? '•••••••• (tersimpan)' : 'Tempel token bot di sini'}
                value={form.botToken}
                onChange={set('botToken')}
                required={!intg}
              />
            </Field>
          </Card>

          <Card title="AutoStore" description="Sumber produk, stok, dan pembayaran QRIS" icon={<Store size={16} />}>
            <Field label="URL AutoStore" htmlFor="autostore-url" hint={intg ? `Saat ini: ${intg.autostoreUrl}` : 'Base URL toko, tanpa /api di belakang.'}>
              <input
                id="autostore-url"
                type="url"
                placeholder={intg?.autostoreUrl ?? 'https://store.contoh.com'}
                value={form.autostoreUrl}
                onChange={set('autostoreUrl')}
                required={!intg}
              />
            </Field>
            <Field label="API Key" htmlFor="api-key" hint={intg?.apiKeyMask ? 'Kosongkan jika tidak ingin mengganti API key.' : undefined}>
              <input
                id="api-key"
                type="password"
                autoComplete="off"
                placeholder={intg?.apiKeyMask ? '•••••••• (tersimpan)' : 'API key dari AutoStore'}
                value={form.apiKey}
                onChange={set('apiKey')}
              />
            </Field>
          </Card>
        </div>

        <div className="card">
          <div className="card-footer" style={{ borderTop: 'none', justifyContent: 'space-between' }}>
            <span className="muted text-sm">Token dan API key disimpan terenkripsi.</span>
            <div className="row">
              {intg && (
                <button type="button" className="btn btn-secondary" onClick={test} disabled={testing}>
                  {testing ? <Spinner /> : <PlugZap size={16} />}
                  Tes Koneksi
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <Spinner /> : <Save size={16} />}
                {intg ? 'Simpan Perubahan' : 'Hubungkan'}
              </button>
            </div>
          </div>
        </div>
      </form>

      {testResult && (
        <div className="grid-2" style={{ marginTop: 20 }}>
          <TestRow ok={testResult.botOk} label="Bot Telegram" error={testResult.botError} />
          <TestRow ok={testResult.autostoreOk} label="AutoStore" error={testResult.autostoreError} />
        </div>
      )}
    </>
  );
}

function TestRow({ ok, label, error }: { ok?: boolean; label: string; error?: string }) {
  return (
    <div className={`alert ${ok ? 'alert-success' : 'alert-error'}`}>
      {ok ? <CircleCheck size={16} /> : <CircleX size={16} />}
      <div>
        <strong>{label}: {ok ? 'terhubung' : 'gagal'}</strong>
        {!ok && error && <div style={{ marginTop: 2 }}>{error}</div>}
      </div>
    </div>
  );
}
