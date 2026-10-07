import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Bot, ShoppingBag, TriangleAlert, Settings, CircleCheck } from 'lucide-react';
import api from '../../lib/api';
import { apiError, timeAgo, formatDateTime } from '../../lib/format';
import { useToast } from '../../contexts/ToastContext';
import { PageHeader, StatCard, Card, LoadingBlock, EmptyState, Badge, Spinner } from '../../components/ui';

interface Stats {
  totalUsers: number;
  activeUsers: number;
  blacklistedUsers: number;
  activeBots: number;
  ordersToday: number;
  recentErrorsCount: number;
  recentErrors: {
    id: number;
    type: string;
    message: string;
    createdAt: string;
    integration: { userId: number; botUsername: string | null };
  }[];
}

export function AdminOverviewPage() {
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/admin/stats').then((r) => setStats(r.data)).catch((err) => toast('error', apiError(err, 'Gagal memuat statistik.')));
    api.get('/admin/settings').then((r) => setRegistrationEnabled(r.data.registrationEnabled)).catch(() => {});
  }, [toast]);

  const toggleRegistration = async () => {
    if (registrationEnabled === null) return;
    setSaving(true);
    try {
      const res = await api.post('/admin/settings', { registrationEnabled: !registrationEnabled });
      setRegistrationEnabled(res.data.registrationEnabled);
      toast('success', res.data.registrationEnabled ? 'Pendaftaran dibuka.' : 'Pendaftaran ditutup.');
    } catch (err) {
      toast('error', apiError(err, 'Gagal mengubah pengaturan.'));
    } finally {
      setSaving(false);
    }
  };

  if (!stats) return <LoadingBlock />;

  return (
    <>
      <PageHeader title="Overview" subtitle="Kondisi platform secara keseluruhan." />

      <div className="stats-grid">
        <StatCard label="Total Pengguna" value={stats.totalUsers} icon={<Users size={16} />} tone="accent"
          hint={`${stats.activeUsers} aktif · ${stats.blacklistedUsers} blacklist`} />
        <StatCard label="Bot Aktif" value={stats.activeBots} icon={<Bot size={16} />} tone="green" />
        <StatCard label="Pesanan Hari Ini" value={stats.ordersToday} icon={<ShoppingBag size={16} />} tone="blue" />
        <StatCard label="Error 24 Jam" value={stats.recentErrorsCount} icon={<TriangleAlert size={16} />} tone={stats.recentErrorsCount ? 'red' : 'green'} />
      </div>

      <div className="grid-main-side">
        <Card flush title="Error Integrasi Terbaru" description="10 kejadian terakhir dari semua bot" icon={<TriangleAlert size={16} />}>
          {stats.recentErrors.length === 0 ? (
            <EmptyState icon={<CircleCheck size={22} />} title="Tidak ada error" description="Semua integrasi berjalan normal." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Bot</th><th>Kejadian</th><th>Waktu</th></tr></thead>
                <tbody>
                  {stats.recentErrors.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link to={`/admin/users/${e.integration.userId}`} className="td-strong">
                          @{e.integration.botUsername ?? `user-${e.integration.userId}`}
                        </Link>
                      </td>
                      <td>
                        <Badge tone="danger">{e.type}</Badge>
                        <div className="td-muted" style={{ marginTop: 4, maxWidth: 420 }}>{e.message}</div>
                      </td>
                      <td className="td-muted" title={formatDateTime(e.createdAt)}>{timeAgo(e.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Pengaturan" icon={<Settings size={16} />}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <div>
              <div className="td-strong">Pendaftaran pengguna baru</div>
              <div className="muted text-sm">
                {registrationEnabled === null ? 'Memuat…' : registrationEnabled ? 'Siapa pun bisa mendaftar.' : 'Form pendaftaran ditutup.'}
              </div>
            </div>
            <button
              className={`btn btn-sm ${registrationEnabled ? 'btn-secondary' : 'btn-success'}`}
              onClick={toggleRegistration}
              disabled={saving || registrationEnabled === null}
            >
              {saving && <Spinner />}
              {registrationEnabled ? 'Tutup' : 'Buka'}
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}
