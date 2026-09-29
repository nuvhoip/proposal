'use client'

// Plain padding wrapper for the Settings section. Navigation between
// Region Settings / User Settings now lives in the left sidebar
// (components/layout/AppShell.tsx), not as in-page tabs.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="nv-page settings-page">
      {children}

      <style jsx>{`
        .settings-page {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          /* padding + max-width come from the global .nv-page shell (56/64/80, 960) */
        }
      `}</style>
    </div>
  )
}
