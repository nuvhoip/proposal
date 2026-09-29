'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { NuvhoLogo, NuvhoIconMark } from '@/components/ui/NuvhoLogo'
import { useSession } from '@/components/auth/AuthGuard'
import { hasUnsavedChanges } from '@/lib/navigationGuard'

// Duotone-thin nav icons (nuvho-brand, served from /public/icons — byte-identical
// to the Nuvho CDN files). Retinted white on the dark sidebar by .nv-navitem__icon.
function NavIcon({ name }: { name: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/icons/${name}.svg`} alt="" width={18} height={18} className="nv-navitem__icon" />
}

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
    icon: <NavIcon name="gauge-simple" />,
  },
  {
    href: '/proposals',
    label: 'Documents',
    icon: <NavIcon name="file-contract" />,
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: <NavIcon name="gears" />,
    children: [
      { href: '/settings/entities',            label: 'Entities'            },
      { href: '/settings/body-configuration',  label: 'Body configuration'  },
      { href: '/settings/teams-channels',      label: 'Teams channels'      },
      { href: '/settings/user-settings',       label: 'User settings'       },
    ],
  },
  {
    href: '/feedback',
    label: 'Feedback',
    icon: <NavIcon name="envelopes" />,
  },
]

const COLLAPSE_KEY = 'nv-sidebar-collapsed' // dimensions.md §2b persistence key

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [signingOut, setSigningOut] = useState(false)
  const pathname = usePathname()
  const router   = useRouter()
  const session  = useSession()

  // Collapsed state is remembered per browser (expanded by default). Read on
  // mount rather than during render so server and client markup match.
  useEffect(() => {
    try { if (window.localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true) } catch { /* storage unavailable */ }
  }, [])
  const setCollapsedPersist = useCallback((next: boolean) => {
    setCollapsed(next)
    try { window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* storage unavailable */ }
  }, [])

  // Close the off-canvas sidebar whenever the route changes (mobile).
  useEffect(() => { setMobileOpen(false) }, [pathname])

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
    <div className="nv-shell">
      {/* Mobile (≤900px) off-canvas toggle — hidden on desktop by CSS */}
      <button
        type="button"
        className="nv-mobile-toggle"
        onClick={() => setMobileOpen(o => !o)}
        aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={mobileOpen}
        aria-controls="nv-sidebar"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mobileOpen ? '/icons/xmark.svg' : '/icons/bars.svg'} alt="" width={16} height={16} />
      </button>
      {mobileOpen && <div className="nv-sidebar-scrim" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar — 260px / 64px, the only two widths (dimensions.md §2b) */}
      <aside
        id="nv-sidebar"
        className={`nv-sidebar ${collapsed ? 'nv-sidebar--collapsed' : ''} ${mobileOpen ? 'nv-open' : ''}`}
      >
        <div className="nv-sidebar__brand">
          {collapsed
            ? <NuvhoIconMark variant="white" size={32} className="nv-sidebar__mark" />
            : <NuvhoLogo variant="white" height={60} className="nv-sidebar__logo" />}
          <button
            type="button"
            className="nv-sidebar__toggle"
            onClick={() => setCollapsedPersist(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={collapsed ? '/icons/angle-right.svg' : '/icons/angle-left.svg'} alt="" width={14} height={14} />
          </button>
        </div>

        {/* Plain flex-row anchors — never <ul>/<li>, never bullets (dimensions.md §2c) */}
        <nav className="nv-sidebar__nav" aria-label="Main">
          {navItems.map(item => {
            const active = pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href))
            const isOpen = expanded[item.href] ?? active
            return (
              <div key={item.href} className="nv-navgroup">
                <div className="nv-navrow">
                  <Link
                    href={item.href}
                    className={`nv-navitem ${active ? 'nv-navitem--active' : ''} ${item.children ? 'nv-navitem--has-children' : ''}`}
                    title={collapsed ? item.label : undefined}
                    aria-current={pathname === item.href ? 'page' : undefined}
                    onClick={e => {
                      // Rail behaviour: clicking a group on the collapsed rail
                      // re-expands the sidebar and opens that group.
                      if (collapsed && item.children) {
                        setCollapsedPersist(false)
                        setExpanded(x => ({ ...x, [item.href]: true }))
                      }
                      handleNavClick(e, item.href)
                    }}
                  >
                    {item.icon}
                    <span className="nv-navitem__label">{item.label}</span>
                    {item.badge != null && item.badge > 0 && (
                      <span className="nv-sidebar__badge">{item.badge}</span>
                    )}
                  </Link>
                  {item.children && (
                    <button
                      type="button"
                      className={`nv-navrow__toggle ${isOpen ? 'nv-navrow__toggle--open' : ''}`}
                      onClick={() => setExpanded(x => ({ ...x, [item.href]: !isOpen }))}
                      aria-label={isOpen ? `Collapse ${item.label}` : `Expand ${item.label}`}
                      aria-expanded={isOpen}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/icons/angle-down.svg" alt="" width={14} height={14} />
                    </button>
                  )}
                </div>

                {item.children && isOpen && (
                  <div className="nv-subnav">
                    {item.children.map(child => {
                      const childActive = pathname === child.href || pathname.startsWith(`${child.href}/`)
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`nv-navitem nv-navitem--sub ${childActive ? 'nv-navitem--active' : ''}`}
                          aria-current={childActive ? 'page' : undefined}
                          onClick={e => handleNavClick(e, child.href)}
                        >
                          <span className="nv-navitem__label">{child.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Account block + copyright — the copyright is the last thing in the sidebar */}
        <div className="nv-sidebar__footer">
          <div className="nv-account" title={collapsed ? (session?.name ?? session?.email ?? '') : undefined}>
            <div className="nv-account__avatar" aria-hidden="true">{initials}</div>
            <div className="nv-account__info">
              <span className="nv-account__name">{session?.name ?? '—'}</span>
              <span className="nv-account__email">{session?.email ?? ''}</span>
            </div>
          </div>
          <button
            type="button"
            className="nv-signout"
            onClick={handleSignOutClick}
            disabled={signingOut}
            title={collapsed ? 'Sign out' : undefined}
            aria-label="Sign out"
          >
            {signingOut
              ? <span className="nv-spinner nv-spinner--sm" style={{ filter: 'brightness(0) invert(1)' }} aria-hidden="true" />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src="/icons/right-from-bracket.svg" alt="" width={16} height={16} />}
            <span className="nv-signout__label">{signingOut ? 'Signing out…' : 'Sign out'}</span>
          </button>
          <span className="nv-sidebar__copyright">© Nuvho Systems Pty Ltd</span>
        </div>
      </aside>

      {/* Main content */}
      <main className="nv-main">
        {children}
      </main>

      {/* Unsaved-changes confirmation — confirm dialog (440, browser-app-shell §9) */}
      {pendingNav && (
        <div className="nv-confirm-overlay" onMouseDown={() => setPendingNav(null)}>
          <div
            className="nv-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nv-confirm-title"
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Escape') setPendingNav(null) }}
          >
            <h3 id="nv-confirm-title">Unsaved changes</h3>
            <p>You have unsaved changes on this proposal. If you leave now, they will be lost.</p>
            <div className="nv-confirm-actions">
              <button
                type="button"
                className="nv-btn nv-btn--secondary"
                onClick={() => setPendingNav(null)}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--primary"
                onClick={confirmPendingNav}
              >
                Leave without saving
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
