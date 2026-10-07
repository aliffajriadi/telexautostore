import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, User, Bot, ShoppingBag, Activity, Ban, RotateCcw, KeyRound } from 'lucide-react';
import api from '../../lib/api';
import { apiError, formatDateTime, formatRupiah, timeAgo } from '../../lib/format';
import { PageHeader, Card, LoadingBlock, EmptyState, Badge, OrderStatusBadge, Alert } from '../../components/ui';
import { UserActionModal, type UserAction } from './UserActionModal';

interface UserDetail {
  id: number;
  username: string;
  email: string;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'BLACKLISTED';
  blacklistReason: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  integration: {
    id: number;
    botUsername: string | null;
    autostoreUrl: string;
    botActive: boolean;
    lastCallbackAt: string | null;
    lastError: string | null;
    createdAt: string;
    orders: { id: number; invoiceCode: string | null; productName: string; qty: number; amount: number; status: string; createdAt: string }[];
    events: { id: number; type: string; message: string; createdAt: string }[];
  } | null;
}

const ERROR_TYPES = new Set(['WEBHOOK_ERROR', 'BOT_ERROR', 'AUTOSTORE_ERROR', 'DELIVERY_FAILED', 'WEBHOOK_REJECTED']);

export function UserDetailPage() {
  const { id } = useParams();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState<UserAction | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/admin/users/${id}`);
      setUser(res.data);
    } catch (err) {
      setError(apiError(err, 'Gagal memuat pengguna.'));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const back = <Link to="/admin/users" className="back-link"><ArrowLeft size={14} /> Semua pengguna</Link>;

  if (error) return <>{back}<Alert type="error">{error}</Alert></>;
  if (!user) return <LoadingBlock />;

  const intg = user.integration;

  return (
    <>
      <PageHeader
        back={back}
        title={user.username}
        subtitle={user.email}
        actions={user.role !== 'ADMIN' && (
          <>
            {user.status === 'ACTIVE' ? (
              <button className="btn btn-danger" onClick={() => setAction('blacklist')}><Ban size={16} /> Blacklist</button>
            ) : (
              <button className="btn btn-success" onClick={() => setAction('unblacklist')}><RotateCcw size={16} /> Pulihkan</button>
            )}
            <button className="btn btn-secondary" onClick={() => setAction('reset-password')}><KeyRound size={16} /> Reset Password</button>
          </>
        )}
      />

      {user.status === 'BLACKLISTED' && (
        <Alert type="error">
          Pengguna ini di-blacklist{user.blacklistReason ? `: ${user.blacklistReason}` : '.'}
        </Alert>
      )}

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <Card title="Akun" icon={<User size={16} />}>
          <dl className="dl">
            <dt>ID</dt><dd>#{user.id}</dd>
            <dt>Role</dt><dd><Badge tone={user.role === 'ADMIN' ? 'accent' : 'neutral'} dot={false}>{user.role}</Badge></dd>
            <dt>Status</dt><dd><Badge tone={user.status === 'ACTIVE' ? 'success' : 'danger'}>{user.status === 'ACTIVE' ? 'Aktif' : 'Blacklist'}</Badge></dd>
            <dt>Terdaftar</dt><dd>{formatDateTime(user.createdAt)}</dd>
            <dt>Login terakhir</dt><dd>{timeAgo(user.lastLoginAt)}</dd>
          </dl>
        </Card>

        <Card title="Bot & Integrasi" icon={<Bot size={16} />}>
          {intg ? (
            <dl className="dl">
              <dt>Bot</dt><dd>@{intg.botUsername ?? '-'}</dd>
              <dt>Status</dt><dd><Badge tone={intg.botActive ? 'success' : 'neutral'}>{intg.botActive ? 'Aktif' : 'Nonaktif'}</Badge></dd>
              <dt>AutoStore</dt><dd className="mono">{intg.autostoreUrl}</dd>
              <dt>Callback terakhir</dt><dd>{timeAgo(intg.lastCallbackAt)}</dd>
              {intg.lastError && (<><dt>Error terakhir</dt><dd style={{ color: 'var(--danger)' }}>{intg.lastError}</dd></>)}
            </dl>
          ) : (
            <p className="muted text-sm">Pengguna belum menghubungkan bot.</p>
          )}
        </Card>
      </div>

      {intg && (
        <div className="stack">
          <Card flush title="Pesanan Terakhir" description="20 pesanan terbaru" icon={<ShoppingBag size={16} />}>
            {intg.orders.length === 0 ? (
              <EmptyState icon={<ShoppingBag size={22} />} title="Belum ada pesanan" />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Kode</th><th>Produk</th><th className="td-right">Total</th><th>Status</th><th>Waktu</th></tr>
                  </thead>
                  <tbody>
                    {intg.orders.map((o) => (
                      <tr key={o.id}>
                        <td className="mono td-strong">{o.invoiceCode ?? `tg-${o.id}`}</td>
                        <td>{o.productName} <span className="td-muted">× {o.qty}</span></td>
                        <td className="td-right td-strong">{formatRupiah(o.amount)}</td>
                        <td><OrderStatusBadge status={o.status} /></td>
                        <td className="td-muted">{formatDateTime(o.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card flush title="Riwayat Kejadian Integrasi" description="Callback ditolak, gagal kirim, error AutoStore" icon={<Activity size={16} />}>
            {intg.events.length === 0 ? (
              <EmptyState icon={<Activity size={22} />} title="Belum ada kejadian" />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Jenis</th><th>Pesan</th><th>Waktu</th></tr></thead>
                  <tbody>
                    {intg.events.map((e) => (
                      <tr key={e.id}>
                        <td><Badge tone={ERROR_TYPES.has(e.type) ? 'danger' : 'info'}>{e.type}</Badge></td>
                        <td className="text-sm">{e.message}</td>
                        <td className="td-muted">{formatDateTime(e.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {action && <UserActionModal user={user} action={action} onClose={() => setAction(null)} onDone={load} />}
    </>
  );
}
