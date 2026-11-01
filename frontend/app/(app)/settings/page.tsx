import { redirect } from 'next/navigation'

// /settings has no content of its own — Entities, Body Configuration, and
// User Settings are now separate sub-pages under the Settings sub-nav (see
// layout.tsx). This keeps the sidebar's "Settings" link (which still points
// at /settings) working by sending it straight to the first sub-page.
export default function SettingsIndexPage() {
  redirect('/settings/entities')
}
