import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Nuvho Proposal System',
  description: 'Automated proposal generation and management for Nuvho Smart Hoteliers',
  icons: {
    icon: '/favicon.ico',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body style={{ fontFamily: 'var(--font-raleway)' }}>
        {children}
      </body>
    </html>
  )
}
