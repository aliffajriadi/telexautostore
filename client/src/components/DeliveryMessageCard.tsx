import React, { useEffect, useRef, useState } from 'react';
import { PackageCheck, Save, FileText } from 'lucide-react';
import api from '../lib/api';
import { apiError, formatRupiah } from '../lib/format';
import { useToast } from '../contexts/ToastContext';
import { Card, Field, Spinner } from './ui';

// Mirrors DEFAULT_DELIVERY_MESSAGE in src/modules/orders/delivery.service.ts
const DEFAULT_DELIVERY_MESSAGE =
  '✅ Pembayaran diterima!\n\n' +
  'Pesanan {product} x{qty} (invoice {invoice}) sudah selesai diproses. ' +
  'Silakan unduh file pesanan kamu di bawah ini.\n\n' +
  'Terima kasih sudah berbelanja!';

const MAX_LENGTH = 1000;

const PLACEHOLDERS: { key: string; label: string; sample: string }[] = [
  { key: '{name}', label: 'Nama pembeli', sample: 'Budi' },
  { key: '{product}', label: 'Nama produk', sample: 'Netflix Premium 1 Bulan' },
  { key: '{qty}', label: 'Jumlah', sample: '2' },
  { key: '{total}', label: 'Total harga', sample: formatRupiah(50000) },
  { key: '{invoice}', label: 'Kode invoice', sample: 'INV-1791375440464-190E' },
];

function renderPreview(template: string): string {
  return PLACEHOLDERS.reduce((text, p) => text.split(p.key).join(p.sample), template || DEFAULT_DELIVERY_MESSAGE);
}

export function DeliveryMessageCard({ initial, onSaved }: { initial: string | null; onSaved: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(initial ?? '');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setValue(initial ?? ''), [initial]);

  const insert = (token: string) => {
    const el = textareaRef.current;
    if (!el) {
      setValue((v) => v + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/dashboard/integration', { deliveryMessage: value });
      toast('success', 'Pesan pengiriman disimpan.');
      onSaved();
    } catch (err) {
      toast('error', apiError(err, 'Gagal menyimpan pesan pengiriman.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid-main-side" style={{ marginTop: 20 }}>
      <form onSubmit={save}>
        <Card
          title="Pesan Pengiriman Barang"
          description="Dikirim bersama file pesanan setelah pembayaran berhasil"
          icon={<PackageCheck size={16} />}
          footer={
            <>
              {value && (
                <button type="button" className="btn btn-ghost" onClick={() => setValue('')} disabled={saving}>
                  Pakai bawaan
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <Spinner /> : <Save size={16} />}
                Simpan
              </button>
            </>
          }
        >
          <Field
            label="Teks Pengiriman"
            htmlFor="delivery-message"
            hint={`Opsional. Kosongkan untuk memakai teks bawaan. ${value.length}/${MAX_LENGTH} karakter.`}
          >
            <textarea
              id="delivery-message"
              ref={textareaRef}
              rows={7}
              maxLength={MAX_LENGTH}
              placeholder={DEFAULT_DELIVERY_MESSAGE}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <div className="label" style={{ marginTop: 4 }}>Sisipkan data pesanan</div>
          <div className="row" style={{ gap: 6 }}>
            {PLACEHOLDERS.map((p) => (
              <button key={p.key} type="button" className="btn btn-secondary btn-sm" onClick={() => insert(p.key)} title={p.label}>
                <code>{p.key}</code>
              </button>
            ))}
          </div>
        </Card>
      </form>

      <Card title="Pratinjau" description="Contoh pesan yang diterima pembeli" icon={<FileText size={16} />}>
        <div className="tg-preview" style={{ minHeight: 0 }}>
          <div className="tg-bubble">
            <div className="tg-file">
              <span className="tg-file-icon"><FileText size={18} /></span>
              <div>
                <div className="tg-file-name">Pesanan_INV-1791375440464-190E.txt</div>
                <div className="tg-file-size">1.2 KB</div>
              </div>
            </div>
            <div className="tg-text">{renderPreview(value)}</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
