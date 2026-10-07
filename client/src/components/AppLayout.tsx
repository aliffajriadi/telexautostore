import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Zap, LayoutDashboard, Bot, Webhook, Palette, ShoppingBag, KeyRound, ShieldCheck,
  Users, ScrollText, LogOut, Menu, ArrowLeftRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean }

const USER_NAV: { section: string; items: NavItem[] }[] = [
  { section: 'Utama', items: [
    { to: '/dashboard', label: 'Ringkasan', icon: LayoutDashboard, end: true },
    { to: '/dashboard/orders', label: 'Pesanan', icon: ShoppingBag },
  ] },
  { section: 'Pengaturan Bot', items: [
    { to: '/dashboard/integration', label: 'Integrasi', icon: Bot },
    { to: '/dashboard/webhook', label: 'Callback & Webhook', icon: Webhook },
    { to: '/dashboard/appearance', label: 'Tampilan Bot', icon: Palette },
  ] },
  { section: 'Akun', items: [
    { to: '/account/password', label: 'Ganti Password', icon: KeyRound },
  ] },
];

const ADMIN_NAV: { section: string; items: NavItem[] }[] = [
  { section: 'Admin', items: [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/users', label: 'Pengguna', icon: Users },
    { to: '/admin/audit', label: 'Audit Log', icon: ScrollText },
  ] },
];

export function AppLayout({ variant }: { variant: 'user' | 'admin' }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Close the mobile drawer on navigation
  useEffect(() => setOpen(false), [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const nav = variant === 'admin' ? ADMIN_NAV : USER_NAV;

  return (
    <div className={`app ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Zap size={18} /></div>
          <div>
            <div className="brand-name">TelexAutoStore</div>
            <div className="brand-sub">{variant === 'admin' ? 'Panel Admin' : 'Bot Management'}</div>
          </div>
        </div>

        <nav className="nav">
          {nav.map((group) => (
            <div key={group.section}>
              <div className="nav-section">{group.section}</div>
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <Icon size={18} />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}

          {user?.role === 'ADMIN' && (
            <div>
              <div className="nav-section">Mode</div>
              <NavLink to={variant === 'admin' ? '/dashboard' : '/admin'} className="nav-link">
                {variant === 'admin' ? <ArrowLeftRight size={18} /> : <ShieldCheck size={18} />}
                {variant === 'admin' ? 'Dashboard Bot' : 'Panel Admin'}
              </NavLink>
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">{user?.username.slice(0, 2)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="user-chip-name">@{user?.username}</div>
              <div className="user-chip-role">{user?.role === 'ADMIN' ? 'Administrator' : 'Pemilik Bot'}</div>
            </div>
          </div>
          <button className="nav-link logout" onClick={handleLogout}>
            <LogOut size={18} />
            Keluar
          </button>
        </div>
      </aside>

      <div className="sidebar-backdrop" onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon" onClick={() => setOpen(true)} aria-label="Buka menu">
            <Menu size={20} />
          </button>
          <div className="brand-name">TelexAutoStore</div>
        </header>
        <main className="main-inner" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
