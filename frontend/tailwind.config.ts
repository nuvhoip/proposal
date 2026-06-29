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
        // Nuvho Primary Palette
        'nv-blue-slate':    '#28687F',
        'nv-steel-blue':    '#6BA1BF',
        'nv-tropical-teal': '#80B9BF',
        'nv-iron-grey':     '#414B4C',
        'nv-platinum':      '#E9EAEC',
        // Nuvho Secondary
        'nv-cherry-rose':   '#982649',
        'nv-deep-purple':   '#672564',
        'nv-wisteria':      '#CEA8E6',
        'nv-tuscan-sun':    '#F3C65D',
        'nv-taupe':         '#A47F7B',
        // Status
        'nv-success':       '#4A8F6E',
        'nv-warning':       '#F3C65D',
        'nv-error':         '#982649',
        'nv-info':          '#6BA1BF',
        // Surfaces
        'nv-surface-page':    '#F5F8F9',
        'nv-surface-card':    '#ffffff',
        'nv-surface-dark':    '#28687F',
        'nv-surface-darker':  '#1E5163',
      },
      fontFamily: {
        display: ['var(--font-comfortaa)', 'Comfortaa', 'system-ui', 'sans-serif'],
        body:    ['var(--font-raleway)', 'Raleway', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        'nv-md':   '14px',
        'nv-pill': '999px',
      },
      boxShadow: {
        'nv-sm': '0 2px 8px rgba(40,104,127,0.07)',
        'nv-md': '0 10px 28px rgba(40,104,127,0.09)',
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
