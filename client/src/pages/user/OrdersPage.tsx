import React, { useEffect, useState } from 'react';
import { Search, ShoppingBag } from 'lucide-react';
import api from '../../lib/api';
import { formatRupiah, formatDateTime, ORDER_STATUS } from '../../lib/format';
import { PageHeader, LoadingBlock, EmptyState, OrderStatusBadge, Pagination } from '../../components/ui';

interface Order {
  id: number;
  invoiceCode: string | null;
  productName: string;
  qty: number;
  amount: number;
  status: string;
  createdAt: string;
}

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  // Debounce typing so every keystroke doesn't hit the API
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string> = { page: String(page) };
    if (search) params.search = search;
    if (status) params.status = status;
    api.get('/dashboard/orders', { params })
      .then((res) => {
        if (cancelled) return;
        setOrders(res.data.orders);
        setTotal(res.data.total);
        setPages(res.data.pages ?? 1);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [page, search, status]);

  const filtered = !!(search || status);

  return (
    <>
      <PageHeader title="Pesanan" subtitle={`${total} pesanan${filtered ? ' cocok dengan filter' : ''}`} />

      <div className="card">
        <div className="toolbar">
          <div className="input-group">
            <Search size={16} className="input-icon" />
            <input
              type="search"
              placeholder="Cari kode invoice atau referensi..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Semua status</option>
            {Object.entries(ORDER_STATUS).map(([key, s]) => (
              <option key={key} value={key}>{s.label}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <LoadingBlock />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag size={22} />}
            title={filtered ? 'Tidak ada pesanan yang cocok' : 'Belum ada pesanan'}
            description={filtered ? 'Coba ubah kata kunci atau filter status.' : 'Pesanan dari pembeli di Telegram akan muncul di sini.'}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kode Invoice</th>
                  <th>Produk</th>
                  <th className="td-right">Qty</th>
                  <th className="td-right">Total</th>
                  <th>Status</th>
                  <th>Waktu</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="mono td-strong">{o.invoiceCode ?? `tg-${o.id}`}</td>
                    <td>{o.productName}</td>
                    <td className="td-right">{o.qty}</td>
                    <td className="td-right td-strong">{formatRupiah(o.amount)}</td>
                    <td><OrderStatusBadge status={o.status} /></td>
                    <td className="td-muted">{formatDateTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} pages={pages} total={total} onChange={setPage} />
      </div>
    </>
  );
}
