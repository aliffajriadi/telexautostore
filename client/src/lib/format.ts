export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID', { dateStyle: 'medium' });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'belum pernah';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} hari lalu`;
  return formatDate(iso);
}

export const ORDER_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING_PAYMENT: { label: 'Menunggu Bayar', tone: 'warning' },
  PAID_MANUAL_PENDING: { label: 'Proses Manual', tone: 'info' },
  PAID: { label: 'Dibayar', tone: 'info' },
  DELIVERED: { label: 'Terkirim', tone: 'success' },
  EXPIRED: { label: 'Kedaluwarsa', tone: 'neutral' },
  FAILED: { label: 'Gagal', tone: 'danger' },
  CANCELLED: { label: 'Dibatalkan', tone: 'neutral' },
};

export const AUDIT_ACTION: Record<string, { label: string; tone: string }> = {
  BLACKLIST: { label: 'Blacklist', tone: 'danger' },
  UNBLACKLIST: { label: 'Unblacklist', tone: 'success' },
  RESET_PASSWORD: { label: 'Reset Password', tone: 'warning' },
};

/** Pulls a human-readable message out of an axios error. */
export function apiError(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: string; errors?: Record<string, string[]> } } })?.response?.data;
  if (data?.error) return data.error;
  const first = data?.errors && Object.values(data.errors).flat()[0];
  return first || fallback;
}
