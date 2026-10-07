import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Package, CircleCheck, Wallet, Users, Check, ArrowRight, TriangleAlert, ShoppingBag } from 'lucide-react';
import api from '../../lib/api';
import { useDashboard } from '../../lib/useDashboard';
import { formatRupiah, formatDateTime, timeAgo } from '../../lib/format';
import { PageHeader, StatCard, Card, LoadingBlock, EmptyState, OrderStatusBadge, Alert } from '../../components/ui';
import { BotToggleButton } from '../../components/BotToggleButton';

interface RecentOrder {
  id: number;
  invoiceCode: string | null;
  productName: string;
  qty: number;
  amount: number;
  status: string;
  createdAt: string;
}

export function OverviewPage() {
  const { data, loading, reload } = useDashboard();
  const [orders, setOrders] = useState<RecentOrder[]>([]);

  useEffect(() => {
    api.get('/dashboard/orders').then((res) => setOrders(res.data.orders.slice(0, 5))).catch(() => {});
  }, []);

  if (loading || !data) return <LoadingBlock />;

  const intg = data.integration;
  const stats = data.stats;

  if (!intg) {
    return (
      <>
        <PageHeader title={`Halo, ${data.user.username} 👋`} subtitle="Ayo hubungkan bot Telegram pertama Anda." />
        <div className="card">
          <EmptyState
            icon={<Bot size={22} />}
            title="Bot belum terhubung"
            description="Masukkan token bot dari @BotFather dan URL AutoStore Anda untuk mulai berjualan lewat Telegram."
            action={
              <Link to="/dashboard/integration" className="btn btn-primary">
                Hubungkan Bot <ArrowRight size={16} />
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const steps = [
    { done: true, label: 'Hubungkan bot Telegram & AutoStore', to: '/dashboard/integration' },
    { done: !!intg.lastCallbackAt, label: 'Pasang Callback URL & secret di AutoStore', to: '/dashboard/webhook' },
    { done: intg.botActive, label: 'Aktifkan bot', to: '/dashboard/integration' },
  ];
  const setupDone = steps.every((s) => s.done);

  return (
    <>
      <PageHeader title={`Halo, ${data.user.username} 👋`} subtitle="Ringkasan performa bot dan pesanan Anda." />

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="bot-hero">
          <div className="bot-avatar"><Bot size={24} /></div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div className="bot-hero-name">@{intg.botUsername ?? 'bot'}</div>
            <div className="bot-hero-meta">
              <span className={`status-dot ${intg.botActive ? 'active' : intg.lastError ? 'error' : 'inactive'}`} />
              {intg.botActive ? 'Aktif melayani pembeli' : intg.lastError ? 'Error' : 'Nonaktif'}
              <span>·</span>
              Callback terakhir {timeAgo(intg.lastCallbackAt)}
            </div>
          </div>
          <div className="bot-hero-actions">
          {intg.botUsername && (
            <a className="btn btn-secondary" href={`https://t.me/${intg.botUsername}`} target="_blank" rel="noreferrer">
              Buka di Telegram
            </a>
          )}
          <BotToggleButton active={intg.botActive} onChanged={reload} />
          </div>
        </div>
      </div>

      {intg.lastError && !intg.botActive && (
        <Alert type="error">Error terakhir: {intg.lastError}</Alert>
      )}

      <div className="stats-grid">
        <StatCard label="Total Pesanan" value={stats.totalOrders} icon={<Package size={16} />} tone="accent" />
        <StatCard label="Pesanan Terkirim" value={stats.successOrders} icon={<CircleCheck size={16} />} tone="green" />
        <StatCard label="Total Omzet" value={formatRupiah(stats.totalRevenue)} icon={<Wallet size={16} />} tone="orange" />
        <StatCard label="Pembeli Unik" value={stats.uniqueBuyers} icon={<Users size={16} />} tone="blue" />
      </div>

      <div className={setupDone ? '' : 'grid-main-side'}>
        <Card
          flush
          title="Pesanan Terbaru"
          description="5 pesanan terakhir dari bot Anda"
          actions={<Link to="/dashboard/orders" className="btn btn-ghost btn-sm">Lihat semua <ArrowRight size={14} /></Link>}
        >
          {orders.length === 0 ? (
            <EmptyState icon={<ShoppingBag size={22} />} title="Belum ada pesanan" description="Pesanan dari pembeli akan muncul di sini." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Produk</th><th>Total</th><th>Status</th><th>Waktu</th></tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <div className="td-strong">{o.productName}</div>
                        <div className="td-muted mono">{o.invoiceCode ?? `tg-${o.id}`} · {o.qty}x</div>
                      </td>
                      <td className="td-strong">{formatRupiah(o.amount)}</td>
                      <td><OrderStatusBadge status={o.status} /></td>
                      <td className="td-muted">{formatDateTime(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {!setupDone && (
          <Card title="Langkah Persiapan" description={`${steps.filter((s) => s.done).length} dari ${steps.length} selesai`} icon={<TriangleAlert size={16} />}>
            <ul className="checklist">
              {steps.map((s) => (
                <li key={s.label} className={s.done ? 'done' : ''}>
                  <Link to={s.to}>
                    <span className="check-circle">{s.done && <Check size={13} strokeWidth={3} />}</span>
                    <span className="label-text">{s.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
