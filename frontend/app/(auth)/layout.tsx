import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign In — Nuvho Proposal System',
  description: 'Sign in with your Nuvho Microsoft account',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
