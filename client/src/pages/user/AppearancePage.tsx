import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Palette, Save, Smartphone } from 'lucide-react';
import api from '../../lib/api';
import { useDashboard } from '../../lib/useDashboard';
import { apiError } from '../../lib/format';
import { useToast } from '../../contexts/ToastContext';
import { PageHeader, Card, Field, LoadingBlock, Spinner, EmptyState } from '../../components/ui';

// Mirrors the bot's defaults in src/modules/bot/bot-handlers.ts
const DEFAULT_IMAGE = 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=800&q=80';
const DEFAULT_MESSAGE = '👋 Halo, {name}!\n\nSelamat datang di AutoStore. Silakan pilih menu di bawah ini untuk memulai berbelanja:';

export function AppearancePage() {
  const { data, loading, reload } = useDashboard();
  const toast = useToast();
  const [form, setForm] = useState({ startMessage: '', startImageUrl: '' });
  const [saving, setSaving] = useState(false);
  const [imgError, setImgError] = useState(false);

  const intg = data?.integration;

  useEffect(() => {
    if (intg) setForm({ startMessage: intg.startMessage ?? '', startImageUrl: intg.startImageUrl ?? '' });
  }, [intg?.startMessage, intg?.startImageUrl]);

  useEffect(() => setImgError(false), [form.startImageUrl]);

  if (loading || !data) return <LoadingBlock />;

  if (!intg) {
    return (
      <>
        <PageHeader title="Tampilan Bot" />
        <div className="card">
          <EmptyState
            icon={<Palette size={22} />}
            title="Belum ada integrasi"
            description="Hubungkan bot terlebih dahulu untuk mengatur tampilannya."
            action={<Link to="/dashboard/integration" className="btn btn-primary">Hubungkan Bot</Link>}
          />
        </div>
      </>
    );
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/dashboard/integration', form);
      toast('success', 'Tampilan bot disimpan.');
      await reload();
    } catch (err) {
      toast('error', apiError(err, 'Gagal menyimpan.'));
    } finally {
      setSaving(false);
    }
  };

  const previewText = (form.startMessage || DEFAULT_MESSAGE).replace(/{name}/g, 'Budi');
  const previewImage = form.startImageUrl || DEFAULT_IMAGE;

  return (
    <>
      <PageHeader title="Tampilan Bot" subtitle="Atur banner dan pesan sambutan saat pembeli mengirim /start." />

      <div className="grid-main-side">
        <form onSubmit={save}>
          <Card
            title="Menu Start"
            icon={<Palette size={16} />}
            footer={
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <Spinner /> : <Save size={16} />}
                Simpan
              </button>
            }
          >
            <Field label="URL Gambar Banner" htmlFor="start-image-url" hint="Opsional. Kosongkan untuk memakai banner bawaan.">
              <input
                id="start-image-url"
                type="url"
                placeholder="https://contoh.com/banner.png"
                value={form.startImageUrl}
                onChange={(e) => setForm((f) => ({ ...f, startImageUrl: e.target.value }))}
              />
            </Field>
            <Field
              label="Pesan Sambutan"
              htmlFor="start-message"
              hint={<>Opsional. Gunakan <code>{'{name}'}</code> untuk menyebut nama pembeli. Teks ditampilkan apa adanya.</>}
            >
              <textarea
                id="start-message"
                rows={6}
                placeholder={DEFAULT_MESSAGE}
                value={form.startMessage}
                onChange={(e) => setForm((f) => ({ ...f, startMessage: e.target.value }))}
              />
            </Field>
          </Card>
        </form>

        <Card title="Pratinjau" description="Perkiraan tampilan di Telegram" icon={<Smartphone size={16} />}>
          <div className="tg-preview">
            <div className="tg-bubble">
              {!imgError ? (
                <img src={previewImage} alt="" onError={() => setImgError(true)} />
              ) : (
                <div className="tg-text muted">⚠️ Gambar gagal dimuat. Bot akan mengirim teks saja.</div>
              )}
              <div className="tg-text">{previewText}</div>
            </div>
            <div className="tg-buttons">
              <div className="tg-btn">🛍️ Katalog Produk</div>
              <div className="tg-btn">📋 Riwayat Pesanan</div>
              <div className="tg-btn">ℹ️ Bantuan</div>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
