'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { NuvhoLogo, NuvhoIconMark } from '@/components/ui/NuvhoLogo'
import { useSession } from '@/components/auth/AuthGuard'
import { hasUnsavedChanges } from '@/lib/navigationGuard'

// CSS filter to render any coloured SVG as white on the dark sidebar
const WHITE_ICON = 'brightness(0) invert(1)'

interface NavChild {
  href:  string
  label: string
}

interface NavItem {
  href:      string
  label:     string
  icon:      React.ReactNode
  badge?:    number
  children?: NavChild[]
}

const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: <Image src="/icons/gauge-simple.svg" width={18} height={18} alt="" style={{ filter: WHITE_ICON }} />,
  },
  {
    href: '/proposals',
    label: 'Documents',
    icon: <Image src="/icons/file-contract.svg" width={18} height={18} alt="" style={{ filter: WHITE_ICON }} />,
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: <Image src="/icons/gears.svg" width={18} height={18} alt="" style={{ filter: WHITE_ICON }} />,
    children: [
      { href: '/settings/entities',            label: 'Entities'            },
      { href: '/settings/body-configuration',  label: 'Body Configuration'  },
      { href: '/settings/teams-channels',      label: 'Teams Channels'      },
      { href: '/settings/user-settings',       label: 'User Settings'       },
    ],
  },
  {
    href: '/feedback',
    label: 'Feedback',
    icon: <Image src="/icons/envelopes.svg" width={18} height={18} alt="" style={{ filter: WHITE_ICON }} />,
  },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [signingOut, setSigningOut] = useState(false)
  const pathname = usePathname()
  const router   = useRouter()
  const session  = useSession()

  // Unsaved-changes confirmation — a page (currently only the proposal
  // wizard) can register a guard via lib/navigationGuard.ts. When one is
  // active and reports unsaved changes, clicking a sidebar/menu link or
  // Sign out is intercepted here and held in pendingNav until the user
  // confirms; "Cancel" just closes the popup and leaves the current page.
  const [pendingNav, setPendingNav] = useState<{ href: string | null; signOut?: boolean } | null>(null)

  function handleNavClick(e: React.MouseEvent, href: string) {
    if (pathname === href) return
    if (hasUnsavedChanges()) {
      e.preventDefault()
      setPendingNav({ href })
    }
  }

  function handleSignOutClick() {
    if (hasUnsavedChanges()) {
      setPendingNav({ href: null, signOut: true })
      return
    }
    handleSignOut()
  }

  function confirmPendingNav() {
    const nav = pendingNav
    setPendingNav(null)
    if (!nav) return
    if (nav.signOut) handleSignOut()
    else if (nav.href) router.push(nav.href)
  }

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
            : <NuvhoLogo variant="white" height={50} />}
          <button
            className="app-sidebar__toggle"
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {/* nuvho-brand icon: chevron-left / chevron-right (duotone-thin) */}
            <svg width="12" height="12" viewBox="0 0 320 512" fill="rgba(255,255,255,0.6)">
              <path d={collapsed
                ? 'M317.7 261.7c3.1-3.1 3.1-8.2 0-11.3l-216-216c-3.1-3.1-8.2-3.1-11.3 0s-3.1 8.2 0 11.3L300.7 256 90.3 466.3c-3.1 3.1-3.1 8.2 0 11.3s8.2 3.1 11.3 0l216-216z'
                : 'M2.3 250.3c-3.1 3.1-3.1 8.2 0 11.3l216 216c3.1 3.1 8.2 3.1 11.3 0s3.1-8.2 0-11.3L19.3 256 229.7 45.7c3.1-3.1 3.1-8.2 0-11.3s-8.2-3.1-11.3 0l-216 216z'}
              />
            </svg>
          </button>
        </div>

        <nav className="app-sidebar__nav">
          {navItems.map(item => {
            const active = pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href))
            const isOpen = expanded[item.href] ?? active
            return (
              <div key={item.href} className="nv-sidebar-nav-group">
                <div className={`nv-sidebar-nav-row ${active ? 'nv-sidebar-nav-item--active' : ''}`}>
                  <Link
                    href={item.href}
                    className="nv-sidebar-nav-item"
                    title={collapsed ? item.label : undefined}
                    onClick={e => handleNavClick(e, item.href)}
                  >
                    <span className="nv-sidebar-nav-item__icon">{item.icon}</span>
                    {!collapsed && (
                      <span className="nv-sidebar-nav-item__label">{item.label}</span>
                    )}
                    {!collapsed && item.badge != null && item.badge > 0 && (
                      <span className="app-sidebar__badge">{item.badge}</span>
                    )}
                  </Link>
                  {!collapsed && item.children && (
                    <button
                      type="button"
                      className={`nv-sidebar-nav-toggle ${isOpen ? 'nv-sidebar-nav-toggle--open' : ''}`}
                      onClick={() => setExpanded(e => ({ ...e, [item.href]: !isOpen }))}
                      aria-label={isOpen ? `Collapse ${item.label}` : `Expand ${item.label}`}
                      aria-expanded={isOpen}
                    >
                      <svg width="10" height="10" viewBox="0 0 320 512" fill="rgba(255,255,255,0.6)">
                        <path d="M310.6 233.4c12.5 12.5 12.5 32.8 0 45.3l-192 192c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L242.7 256 73.4 86.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l192 192z"/>
                      </svg>
                    </button>
                  )}
                </div>

                {!collapsed && item.children && isOpen && (
                  <div className="nv-sidebar-subnav">
                    {item.children.map(child => {
                      const childActive = pathname === child.href || pathname.startsWith(`${child.href}/`)
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`nv-sidebar-subnav-item ${childActive ? 'nv-sidebar-subnav-item--active' : ''}`}
                          onClick={e => handleNavClick(e, child.href)}
                        >
                          <span className="nv-sidebar-subnav-item__label">{child.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
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
            onClick={handleSignOutClick}
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
            <span className="app-sidebar__copyright">© Nuvho Systems Pty Ltd</span>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="app-main">
        {children}
      </main>

      {/* Unsaved-changes confirmation popup */}
      {pendingNav && (
        <div className="nv-confirm-overlay" onMouseDown={() => setPendingNav(null)}>
          <div
            className="nv-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nv-confirm-title"
            onMouseDown={e => e.stopPropagation()}
          >
            <h3 id="nv-confirm-title">Unsaved changes</h3>
            <p>You have unsaved changes on this proposal. If you leave now, they will be lost.</p>
            <div className="nv-confirm-actions">
              <button
                type="button"
                className="nv-btn nv-btn--outlined nv-btn--md"
                onClick={() => setPendingNav(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--solid nv-btn--md"
                onClick={confirmPendingNav}
              >
                Leave without saving
              </button>
            </div>
          </div>
        </div>
      )}

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

        .nv-sidebar-nav-group {
          display: flex;
          flex-direction: column;
        }

        .nv-sidebar-nav-row {
          display: flex;
          align-items: center;
          border-radius: 10px;
        }
        .nv-sidebar-nav-row .nv-sidebar-nav-item {
          flex: 1;
          min-width: 0;
        }
        .nv-sidebar-nav-toggle {
          background: none;
          border: none;
          padding: 8px;
          margin-right: 4px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: transform var(--nv-dur) var(--nv-ease), background var(--nv-dur);
        }
        .nv-sidebar-nav-toggle:hover { background: rgba(255,255,255,0.1); }
        .nv-sidebar-nav-toggle--open { transform: rotate(90deg); }

        .nv-sidebar-subnav {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding-left: 30px;
          margin: 4px 0 8px;
        }
        /* .nv-sidebar-subnav-item itself (font-size, hover/active background,
           color) is intentionally NOT styled here — it lives as a plain
           global !important rule in globals.css instead, because this
           styled-jsx version was proven to get shadowed/lost on hot-reload
           (see the comment above that rule in globals.css). Don't re-add
           those properties here. */

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

        /* ── Unsaved-changes confirmation popup ──
           Mirrors the hg-modal-overlay/hg-modal pattern used in the proposal
           wizard (app/(app)/proposals/new/page.tsx) for visual consistency,
           redeclared here since styled-jsx scopes rules to the component
           that defines them. */
        .nv-confirm-overlay {
          position: fixed; inset: 0; z-index: 200;
          background: rgba(30,40,45,0.45);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        .nv-confirm-modal {
          width: 100%; max-width: 440px;
          background: var(--nv-surface-card); border-radius: var(--nv-radius-md);
          box-shadow: var(--nv-shadow-md);
          padding: 28px;
        }
        .nv-confirm-modal h3 {
          margin: 0 0 12px; font-family: var(--font-comfortaa); font-size: 20px;
          font-weight: 700; color: var(--nv-text-heading);
        }
        .nv-confirm-modal p {
          margin: 0 0 24px; font-size: 14px; color: var(--nv-text-muted); line-height: 1.5;
        }
        .nv-confirm-actions {
          display: flex; justify-content: flex-end; gap: 12px;
        }
      `}</style>
    </div>
  )
}

/* ── Sign-out icon — nuvho-brand: right-from-bracket (duotone-thin) ── */
function IconSignout() {
  return (
    <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
      <path d="M493.7 250.3c3.1 3.1 3.1 8.2 0 11.3l-144 144c-2.3 2.3-5.7 3-8.7 1.7l0 0c-3-1.2-4.9-4.2-4.9-7.4l0-88c0-4.4-3.6-8-8-8l-120 0c-17.7 0-32-14.3-32-32l0-32c0-17.7 14.3-32 32-32l120 0c4.4 0 8-3.6 8-8l0-88c0-3.2 1.9-6.2 4.9-7.4s6.4-.6 8.7 1.7l144 144zM361 417L505 273c9.4-9.4 9.4-24.6 0-33.9l0 0-144-144c-6.9-6.9-17.2-8.9-26.2-5.2S320 102.3 320 112l0 80-112 0c-26.5 0-48 21.5-48 48l0 32c0 26.5 21.5 48 48 48l112 0 0 80c0 9.7 5.8 18.5 14.8 22.2s19.3 1.7 26.2-5.2zM184 48c4.4 0 8-3.6 8-8s-3.6-8-8-8L96 32C43 32 0 75 0 128L0 384c0 53 43 96 96 96l88 0c4.4 0 8-3.6 8-8s-3.6-8-8-8l-88 0c-44.2 0-80-35.8-80-80l0-256c0-44.2 35.8-80 80-80l88 0z"/>
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
