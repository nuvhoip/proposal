import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/AppShell'
import { AuthGuard } from '@/components/auth/AuthGuard'

export const metadata: Metadata = {
  title: 'Nuvho Proposal System',
}

/**
 * Auth is enforced client-side via AuthGuard.
 *
 * The nuvho_session cookie is set by proposals-api.nuvho.com — a different
 * domain to the frontend. Next.js server components (cookies() / next/headers)
 * only see cookies scoped to the frontend domain, so a server-side check
 * always sees an empty cookie store and redirects to /login even after a
 * successful sign-in. AuthGuard calls /auth/me from the browser, which
 * correctly sends the cross-domain cookie to the Worker.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AppShell>{children}</AppShell>
    </AuthGuard>
  )
}
