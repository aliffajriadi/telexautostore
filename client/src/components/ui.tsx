import React, { useEffect, useState, type ReactNode } from 'react';
import { Check, Copy, ChevronLeft, ChevronRight, X, Inbox, CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { ORDER_STATUS } from '../lib/format';

export function Spinner({ large = false }: { large?: boolean }) {
  return <span className={`spinner ${large ? 'spinner-lg' : ''}`} aria-label="Memuat" />;
}

export function LoadingBlock() {
  return (
    <div className="loading-block">
      <Spinner large />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <>
      {back}
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </>
  );
}

export function Card({ title, description, icon, actions, footer, children, flush = false, className = '' }: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${flush ? 'card-flush' : ''} ${className}`}>
      {(title || actions) && (
        <div className="card-header" style={flush ? { paddingBottom: 16 } : undefined}>
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            {icon && <span className="card-icon">{icon}</span>}
            <div>
              {title && <h2 className="card-title">{title}</h2>}
              {description && <p className="card-desc">{description}</p>}
            </div>
          </div>
          {actions}
        </div>
      )}
      <div className="card-body">{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </section>
  );
}

export function StatCard({ label, value, icon, tone, hint }: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone: 'accent' | 'green' | 'orange' | 'blue' | 'red';
  hint?: ReactNode;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className={`stat-icon ${tone}`}>{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children, dot = true }: { tone?: string; children: ReactNode; dot?: boolean }) {
  return <span className={`badge badge-${tone} ${dot ? '' : 'no-dot'}`}>{children}</span>;
}

export function OrderStatusBadge({ status }: { status: string }) {
  const s = ORDER_STATUS[status] ?? { label: status, tone: 'neutral' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const ALERT_ICONS = { error: CircleAlert, success: CircleCheck, warning: TriangleAlert, info: Info };

export function Alert({ type, children }: { type: 'error' | 'success' | 'warning' | 'info'; children: ReactNode }) {
  const Icon = ALERT_ICONS[type];
  return (
    <div className={`alert alert-${type} alert-spaced`} role={type === 'error' ? 'alert' : 'status'}>
      <Icon size={16} />
      <div>{children}</div>
    </div>
  );
}

export function Field({ label, htmlFor, hint, error, children }: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="copy-field">
      <span className="copy-field-value" title={value}>{value}</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={copy} aria-label={label ? `Salin ${label}` : 'Salin'}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? 'Disalin' : 'Salin'}
      </button>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <Inbox size={22} />}</div>
      <div className="empty-title">{title}</div>
      {description && <p className="empty-desc">{description}</p>}
      {action}
    </div>
  );
}

export function Pagination({ page, pages, total, onChange }: {
  page: number;
  pages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (pages <= 1) return null;
  // Window of up to 5 page numbers around the current page
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const nums = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  return (
    <div className="pagination">
      <span>Halaman {page} dari {pages} · {total} data</span>
      <div className="pagination-pages">
        <button className="page-btn" disabled={page === 1} onClick={() => onChange(page - 1)} aria-label="Sebelumnya">
          <ChevronLeft size={16} />
        </button>
        {nums.map((n) => (
          <button key={n} className={`page-btn ${n === page ? 'active' : ''}`} onClick={() => onChange(n)}>
            {n}
          </button>
        ))}
        <button className="page-btn" disabled={page === pages} onClick={() => onChange(page + 1)} aria-label="Berikutnya">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

export function Modal({ title, description, onClose, children, footer }: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">{title}</h3>
            {description && <p className="modal-desc">{description}</p>}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Tutup">
            <X size={18} />
          </button>
        </div>
        {children && <div className="modal-body">{children}</div>}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation dialog, replacing window.confirm. */
export function ConfirmModal({ title, description, confirmLabel = 'Konfirmasi', danger = false, loading = false, onConfirm, onClose }: {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={loading}>Batal</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={loading}>
            {loading && <Spinner />}
            {confirmLabel}
          </button>
        </>
      }
    />
  );
}
