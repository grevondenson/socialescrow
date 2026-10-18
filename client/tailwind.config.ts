import type { Config } from 'tailwindcss';

/**
 * "Vault Ledger" design tokens — SocialEscrow.
 *
 * The palette is a ledger, not a SaaS dashboard: ink on warm paper, one deep forest
 * for action, ochre for anything awaiting a human, clay for anything that moved wrong.
 * Neutrals are green-tinted on purpose — plain `slate` next to `forest` reads grey and
 * cheap; a green-black ramp keeps the whole surface in the same family.
 *
 * Deliberately absent: indigo (the codebase's accidental default) and #22c55e (the
 * stock "prosperity green" that makes every African-market template look the same).
 */
const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#0E211C',
        paper: '#F5F6F2',
        forest: {
          DEFAULT: '#14543F',
          50: '#EDF6F1',
          100: '#DCEBE2',
          200: '#B9D6C6',
          300: '#8DBAA4',
          400: '#5C9880',
          500: '#367A60',
          600: '#1F664E',
          700: '#14543F',
          800: '#103F30',
          900: '#0C2C22',
        },
        mint: '#DCEBE2',
        ochre: {
          DEFAULT: '#A8630C',
          50: '#FBF3E4',
          100: '#F5E4C6',
          200: '#E8C68C',
          300: '#D4A454',
          400: '#BC8530',
          500: '#A8630C',
          600: '#8A500A',
        },
        clay: {
          DEFAULT: '#9E3320',
          50: '#FBEDEA',
          100: '#F5D8D2',
          200: '#E7B0A5',
          300: '#D48274',
          400: '#BC5744',
          500: '#9E3320',
          600: '#822818',
        },
        // Green-tinted neutrals. Named by role so pages stop reaching for slate-*.
        neutral: {
          50: '#F5F6F2',
          100: '#E9ECE4',
          200: '#D5DACF',
          300: '#B8C1B2',
          400: '#8E9989',
          500: '#6B7668',
          600: '#4F5A4C',
          700: '#3A4438',
          800: '#273129',
          900: '#1A231D',
          950: '#0E211C',
        },
      },
      fontFamily: {
        // Wired to next/font CSS variables in app/layout.tsx.
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // A tighter scale than Tailwind's default: less air, more ledger.
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
      },
      borderRadius: {
        // Two radii only: cards are soft, controls are tight. No single-radius-everything kit.
        card: '0.875rem',
        control: '0.5rem',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(14 33 28 / 0.04), 0 1px 3px 1px rgb(14 33 28 / 0.05)',
        lift: '0 4px 16px -2px rgb(14 33 28 / 0.10), 0 2px 6px -2px rgb(14 33 28 / 0.06)',
        rail: 'inset 2px 0 0 0 currentColor',
      },
      keyframes: {
        'rail-fill': {
          '0%': { transform: 'scaleY(0)' },
          '100%': { transform: 'scaleY(1)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'rail-fill': 'rail-fill 240ms ease-out',
        'fade-in': 'fade-in 160ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
