import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Nuvho primary palette (nuvho-brand v3 — the only brand colours)
        'nv-blue-slate':    '#28687F',
        'nv-steel-blue':    '#6BA1BF',
        'nv-tropical-teal': '#80B9BF',
        'nv-iron-grey':     '#414B4C',
        'nv-platinum':      '#E9EAEC',
        // Blue Slate ladder
        'nv-blue-500': '#3E7F96', 'nv-blue-300': '#96BFD4', 'nv-teal-300': '#AAD2D6',
        'nv-blue-200': '#C0D8E5', 'nv-blue-100': '#E3EDF3', 'nv-teal-100': '#E4F1F2',
        // Status — the only sanctioned extra hues (Deep Purple / Wisteria /
        // Taupe retired 2026-09-09; never use Tailwind amber/green for status)
        'nv-success':       '#4A8F6E',
        'nv-warning':       '#F3C65D',
        'nv-error':         '#982649',
        'nv-neutral':       '#5E6B6C',
        'nv-info':          '#6BA1BF',
        // Surfaces
        'nv-surface-page':    '#F5F8F9',
        'nv-surface-card':    '#ffffff',
        'nv-surface-dark':    '#28687F',
        'nv-surface-darker':  '#1E5163',
      },
      fontFamily: {
        display: ['Comfortaa', 'system-ui', 'sans-serif'],
        body:    ['Raleway', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        'nv-sm':   '6px',
        'nv-md':   '14px',
        'nv-lg':   '24px',
        'nv-pill': '999px',
      },
      // Figma components carry no drop shadows — kept as named no-ops so any
      // shadow-nv-* utility still compiles but renders flat.
      boxShadow: {
        'nv-sm': 'none',
        'nv-md': 'none',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-left': {
          '0%': { opacity: '0', transform: 'translateX(-16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-in-left': 'slide-in-left 0.3s ease-out',
      },
    },
  },
  plugins: [],
}

export default config
