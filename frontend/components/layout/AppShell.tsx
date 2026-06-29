'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { NuvhoLogo, NuvhoIconMark } from '@/components/ui/NuvhoLogo'
import { useSession } from '@/components/auth/AuthGuard'

// CSS filter to render any coloured SVG as white on the dark sidebar
const WHITE_ICON = 'brightness(0) invert(1)'

interface NavItem {
  href:   string
  label:  string
  icon:   React.ReactNode
  badge?: number
}

const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: <img src="/icons/gauge-simple.svg" width="18" height="18" alt="" style={{ filter: WHITE_ICON }} />,
  },
  {
    href: '/proposals',
    label: 'Proposals',
    icon: <img src="/icons/file-contract.svg" width="18" height="18" alt="" style={{ filter: WHITE_ICON }} />,
  },
  {
    href: '/proposals/new',
    label: 'New Proposal',
    icon: <img src="/icons/rocket.svg" width="18" height="18" alt="" style={{ filter: WHITE_ICON }} />,
  },
  {
    href: '/engagements',
    label: 'Engagements',
    icon: <img src="/icons/handshake.svg" width="18" height="18" alt="" style={{ filter: WHITE_ICON }} />,
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: <img src="/icons/gears.svg" width="18" height="18" alt="" style={{ filter: WHITE_ICON }} />,
  },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const pathname = usePathname()
  const router   = useRouter()
  const session  = useSession()

  // Derive initials for avatar (e.g. "Ody Bolger" → "OB", "info@nuvho.com" → "IN")
  const initials = session?.name
    ? session.name.split(' ').map((w: string) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('')
    : session?.email?.slice(0, 2).toUpperCase() ?? '??'

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_WORKER_URL}/auth/signout`,
        { method: 'POST', credentials: 'include' },
      )
    } catch {
      // Ignore network errors — clear session client-side regardless
    } finally {
      setSigningOut(false)
      router.push('/login')
    }
  }

  return (
    <div className={`app-shell ${collapsed ? 'app-shell--collapsed' : ''}`}>
      {/* Sidebar */}
      <aside className="app-sidebar">
        <div className="app-sidebar__header">
          {collapsed
            ? <NuvhoIconMark variant="white" size={32} />
            : <NuvhoLogo variant="white" height={34} />}
          <button
            className="app-sidebar__toggle"
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d={collapsed
                  ? 'M6 3l5 5-5 5'
                  : 'M10 3L5 8l5 5'}
                stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <nav className="app-sidebar__nav">
          {navItems.map(item => {
            const active = pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nv-sidebar-nav-item ${active ? 'nv-sidebar-nav-item--active' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <span className="nv-sidebar-nav-item__icon">{item.icon}</span>
                {!collapsed && (
                  <span className="nv-sidebar-nav-item__label">{item.label}</span>
                )}
                {!collapsed && item.badge != null && item.badge > 0 && (
                  <span className="app-sidebar__badge">{item.badge}</span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="app-sidebar__footer">
          {!collapsed && (
            <div className="app-sidebar__user">
              <div className="app-sidebar__avatar">{initials}</div>
              <div className="app-sidebar__user-info">
                <span className="app-sidebar__user-name">{session?.name ?? '—'}</span>
                <span className="app-sidebar__user-email">{session?.email ?? ''}</span>
              </div>
            </div>
          )}
          <button
            className="app-sidebar__signout"
            onClick={handleSignOut}
            disabled={signingOut}
            title="Sign out"
            aria-label="Sign out"
          >
            {signingOut
              ? <IconSpinner />
              : <IconSignout />}
          </button>
        </div>

        {/* Brand footer */}
        <div className="app-sidebar__brand">
          {!collapsed && (
            <>
              <NuvhoLogo variant="white" height={28} />
              <span className="app-sidebar__copyright">© Nuvho Systems Pty Ltd</span>
            </>
          )}
          {collapsed && (
            <NuvhoIconMark variant="white" size={20} />
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="app-main">
        {children}
      </main>

      <style jsx>{`
        .app-shell {
          display: flex;
          min-height: 100vh;
          background: var(--nv-surface-page);
        }

        /* ── Sidebar ── */
        .app-sidebar {
          width: 240px;
          min-width: 240px;
          background: var(--nv-surface-dark);
          display: flex;
          flex-direction: column;
          position: sticky;
          top: 0;
          height: 100vh;
          overflow: hidden;
          transition: width 220ms var(--nv-ease), min-width 220ms var(--nv-ease);
          z-index: 40;
        }
        .app-shell--collapsed .app-sidebar {
          width: 64px;
          min-width: 64px;
        }

        .app-sidebar__header {
          padding: 20px 16px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          min-height: 64px;
        }

        .app-sidebar__toggle {
          background: rgba(255,255,255,0.1);
          border: none;
          border-radius: 6px;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: background var(--nv-dur);
        }
        .app-sidebar__toggle:hover { background: rgba(255,255,255,0.18); }

        .app-sidebar__nav {
          flex: 1;
          padding: 12px 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          overflow-y: auto;
        }

        /* badge */
        .app-sidebar__badge {
          margin-left: auto;
          background: var(--nv-tropical-teal);
          color: var(--nv-surface-dark);
          font-size: 11px;
          font-weight: 700;
          padding: 1px 7px;
          border-radius: 999px;
          line-height: 18px;
        }

        .app-sidebar__footer {
          padding: 12px 8px;
          border-top: 1px solid rgba(255,255,255,0.08);
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .app-sidebar__user {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .app-sidebar__avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--nv-tropical-teal);
          color: var(--nv-surface-dark);
          font-family: var(--font-comfortaa);
          font-size: 12px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .app-sidebar__user-info {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .app-sidebar__user-name {
          font-size: 13px;
          font-weight: 600;
          color: white;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .app-sidebar__user-email {
          font-size: 11px;
          color: rgba(255,255,255,0.5);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .app-sidebar__signout {
          background: none;
          border: none;
          padding: 6px;
          border-radius: 6px;
          cursor: pointer;
          color: rgba(255,255,255,0.5);
          display: flex;
          transition: background var(--nv-dur), color var(--nv-dur);
          flex-shrink: 0;
        }
        .app-sidebar__signout:hover:not(:disabled) {
          background: rgba(255,255,255,0.1);
          color: rgba(255,255,255,0.9);
        }
        .app-sidebar__signout:disabled {
          cursor: wait;
          opacity: 0.6;
        }

        /* ── Brand footer ── */
        .app-sidebar__brand {
          padding: 10px 12px 14px;
          border-top: 1px solid rgba(255,255,255,0.08);
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
        }
        .app-shell--collapsed .app-sidebar__brand {
          align-items: center;
        }
        .app-sidebar__copyright {
          font-size: 10px;
          color: rgba(255,255,255,0.35);
          font-family: var(--font-raleway), system-ui, sans-serif;
          white-space: nowrap;
          letter-spacing: 0.01em;
        }

        /* ── Main content ── */
        .app-main {
          flex: 1;
          min-width: 0;
          overflow-y: auto;
        }
      `}</style>
    </div>
  )
}

/* ── Sign-out icon ── */
function IconSignout() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M11 11l3-3-3-3M14 8H6"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

/* ── Spinner shown while signing out ── */
function IconSpinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
      style={{ animation: 'spin 0.8s linear infinite' }}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeDasharray="28" strokeDashoffset="10" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  )
}
