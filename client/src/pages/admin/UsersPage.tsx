import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Ban, RotateCcw, KeyRound } from 'lucide-react';
import api from '../../lib/api';
import { apiError, formatDate, timeAgo } from '../../lib/format';
import { useToast } from '../../contexts/ToastContext';
import { PageHeader, LoadingBlock, EmptyState, Badge, Pagination } from '../../components/ui';
import { UserActionModal, type UserAction } from './UserActionModal';

interface UserItem {
  id: number;
  username: string;
  email: string;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'BLACKLISTED';
  botActive: boolean;
  botUsername: string | null;
  orderCount: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export function UsersPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ user: UserItem; action: UserAction } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/users', { params: { page, ...(search ? { search } : {}) } });
      setUsers(res.data.users);
      setTotal(res.data.total);
      setPages(res.data.pages || 1);
    } catch (err) {
      toast('error', apiError(err, 'Gagal memuat pengguna.'));
    } finally {
      setLoading(false);
    }
  }, [page, search, toast]);

  useEffect(() => { load(); }, [load]);

  const act = (e: React.MouseEvent, user: UserItem, action: UserAction) => {
    e.stopPropagation();
    setModal({ user, action });
  };

  return (
    <>
      <PageHeader title="Pengguna" subtitle={`${total} pengguna terdaftar`} />

      <div className="card">
        <div className="toolbar">
          <div className="input-group">
            <Search size={16} className="input-icon" />
            <input type="search" placeholder="Cari username atau email..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <LoadingBlock />
        ) : users.length === 0 ? (
          <EmptyState icon={<Users size={22} />} title="Tidak ada pengguna" description={search ? 'Coba kata kunci lain.' : undefined} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pengguna</th>
                  <th>Status</th>
                  <th>Bot</th>
                  <th className="td-right">Pesanan</th>
                  <th>Login Terakhir</th>
                  <th>Terdaftar</th>
                  <th className="td-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="clickable" onClick={() => navigate(`/admin/users/${u.id}`)}>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <div className="avatar">{u.username.slice(0, 2)}</div>
                        <div>
                          <div className="td-strong">
                            {u.username} {u.role === 'ADMIN' && <Badge tone="accent" dot={false}>Admin</Badge>}
                          </div>
                          <div className="td-muted">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge tone={u.status === 'ACTIVE' ? 'success' : 'danger'}>{u.status === 'ACTIVE' ? 'Aktif' : 'Blacklist'}</Badge>
                    </td>
                    <td>
                      {u.botUsername ? (
                        <div>
                          <Badge tone={u.botActive ? 'success' : 'neutral'}>{u.botActive ? 'Aktif' : 'Nonaktif'}</Badge>
                          <div className="td-muted">@{u.botUsername}</div>
                        </div>
                      ) : (
                        <span className="td-muted">Belum terhubung</span>
                      )}
                    </td>
                    <td className="td-right">{u.orderCount}</td>
                    <td className="td-muted">{timeAgo(u.lastLoginAt)}</td>
                    <td className="td-muted">{formatDate(u.createdAt)}</td>
                    <td className="td-right">
                      {u.role !== 'ADMIN' && (
                        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap', gap: 6 }}>
                          {u.status === 'ACTIVE' ? (
                            <button className="btn btn-danger btn-sm btn-icon" title="Blacklist" onClick={(e) => act(e, u, 'blacklist')}>
                              <Ban size={15} />
                            </button>
                          ) : (
                            <button className="btn btn-success btn-sm btn-icon" title="Pulihkan" onClick={(e) => act(e, u, 'unblacklist')}>
                              <RotateCcw size={15} />
                            </button>
                          )}
                          <button className="btn btn-secondary btn-sm btn-icon" title="Reset password" onClick={(e) => act(e, u, 'reset-password')}>
                            <KeyRound size={15} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} pages={pages} total={total} onChange={setPage} />
      </div>

      {modal && <UserActionModal user={modal.user} action={modal.action} onClose={() => setModal(null)} onDone={load} />}
    </>
  );
}
