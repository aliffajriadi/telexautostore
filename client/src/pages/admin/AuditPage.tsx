import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import api from '../../lib/api';
import { apiError, formatDateTime, AUDIT_ACTION } from '../../lib/format';
import { useToast } from '../../contexts/ToastContext';
import { PageHeader, LoadingBlock, EmptyState, Badge, Pagination } from '../../components/ui';

interface AuditLog {
  id: number;
  adminId: number;
  adminUsername: string | null;
  targetUserId: number;
  targetUsername: string | null;
  action: string;
  reason: string | null;
  createdAt: string;
}

export function AuditPage() {
  const toast = useToast();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/admin/audit', { params: { page } })
      .then((res) => {
        setLogs(res.data.logs);
        setPages(res.data.pages || 1);
        setTotal(res.data.total);
      })
      .catch((err) => toast('error', apiError(err, 'Gagal memuat audit log.')))
      .finally(() => setLoading(false));
  }, [page, toast]);

  return (
    <>
      <PageHeader title="Audit Log" subtitle="Semua aksi admin terhadap pengguna tercatat di sini." />

      <div className="card">
        {loading ? (
          <LoadingBlock />
        ) : logs.length === 0 ? (
          <EmptyState icon={<ScrollText size={22} />} title="Belum ada catatan" description="Aksi blacklist, unblacklist, dan reset password akan muncul di sini." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Waktu</th><th>Admin</th><th>Aksi</th><th>Target</th><th>Alasan</th></tr>
              </thead>
              <tbody>
                {logs.map((l) => {
                  const a = AUDIT_ACTION[l.action] ?? { label: l.action, tone: 'neutral' };
                  return (
                    <tr key={l.id}>
                      <td className="td-muted">{formatDateTime(l.createdAt)}</td>
                      <td className="td-strong">@{l.adminUsername ?? `#${l.adminId}`}</td>
                      <td><Badge tone={a.tone}>{a.label}</Badge></td>
                      <td>
                        <Link to={`/admin/users/${l.targetUserId}`}>@{l.targetUsername ?? `#${l.targetUserId}`}</Link>
                      </td>
                      <td className="text-sm">{l.reason || <span className="muted">-</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onChange={setPage} />
      </div>
    </>
  );
}
