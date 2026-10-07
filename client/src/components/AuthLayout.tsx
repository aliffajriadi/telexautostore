import React, { type ReactNode } from 'react';
import { Zap, Bot, QrCode, ShieldCheck } from 'lucide-react';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="brand" style={{ padding: 0, position: 'relative' }}>
          <div className="brand-mark"><Zap size={18} /></div>
          <div className="brand-name">TelexAutoStore</div>
        </div>
        <div>
          <h2>Jualan produk digital lewat bot Telegram, otomatis.</h2>
          <p>Hubungkan bot Anda ke AutoStore. Katalog, pembayaran QRIS, dan pengiriman item berjalan sendiri.</p>
          <ul className="auth-features">
            <li><Bot size={18} /> Satu bot per akun, aktif dalam hitungan menit</li>
            <li><QrCode size={18} /> Invoice QRIS dibuat otomatis untuk setiap pesanan</li>
            <li><ShieldCheck size={18} /> Token & API key disimpan terenkripsi</li>
          </ul>
        </div>
        <div className="muted text-sm" style={{ position: 'relative' }}>© {new Date().getFullYear()} TelexAutoStore</div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}
