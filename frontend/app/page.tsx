import { redirect } from 'next/navigation'

/**
 * Root redirect — sends users to the dashboard.
 * The app layout will handle the auth check and redirect to /login if needed.
 */
export default function RootPage() {
  redirect('/dashboard')
}
