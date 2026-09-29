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
    <html lang="en-AU">
      <head>
        {/* Brand fonts are self-hosted from /public/fonts (see globals.css) —
            the Google Fonts preconnects are gone with the Google Fonts @import. */}
        <link rel="preload" href="/fonts/Raleway-VariableFont_wght.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/Comfortaa-VariableFont_wght.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
