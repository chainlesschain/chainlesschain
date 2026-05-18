/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        paper: '#FAF9F5',
        ink: '#1E1E1C',
        ember: '#D97757',
        'ember-dark': '#C86748',
        cream: '#F4F3ED',
        muted: '#6B6A65',
        'muted-dark': '#9A9892',
        line: '#E8E5DC',
        'line-dark': '#2E2D2A',
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'display-xl': ['5.5rem', { lineHeight: '1.02', letterSpacing: '-0.02em' }],
        'display-lg': ['4rem', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        'display-md': ['3rem', { lineHeight: '1.1', letterSpacing: '-0.015em' }],
      },
      maxWidth: {
        content: '1200px',
      },
      keyframes: {
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(30px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fadeInUp 0.8s ease-out',
        'fade-in-1': 'fadeInUp 0.8s ease-out 0.2s both',
        'fade-in-2': 'fadeInUp 0.8s ease-out 0.4s both',
        'fade-in-3': 'fadeInUp 0.8s ease-out 0.6s both',
      },
    },
  },
  plugins: [],
};
