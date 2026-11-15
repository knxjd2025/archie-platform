/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './client/index.html',
    './client/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Archie's neutral palette. `blue` is remapped to Archie navy so the
        // app's existing `blue-*` primary usages share one calm color.
        blue: {
          50: '#eef2f7',
          100: '#dce4ee',
          200: '#b9c8dc',
          300: '#8ea5c3',
          400: '#5f7ea5',
          500: '#3d5d86',
          600: '#1f3a5f', // Archie navy
          700: '#192f4d',
          800: '#13243b',
          900: '#0d1929',
          950: '#0a131f',
        },
        // App chrome (header, primary surfaces). Archie's navy by default; a
        // company that picks a main color on the Company page gets it here
        // (CSS variables set by client/src/lib/brand.ts). The fallbacks are
        // Archie's own values, so with nothing set the app looks as it always has.
        ink: {
          DEFAULT: 'rgb(var(--ink, 31 58 95) / <alpha-value>)',
          dark: 'rgb(var(--ink-dark, 22 41 63) / <alpha-value>)',
          deep: 'rgb(var(--ink-deep, 15 28 44) / <alpha-value>)',
        },
        // The signed-in company's colors, set at runtime on :root from its
        // profile (client/src/lib/brand.ts). Archie navy until then.
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          light: 'rgb(var(--brand-light) / <alpha-value>)',
          dark: 'rgb(var(--brand-dark) / <alpha-value>)',
          accent: 'rgb(var(--brand-accent) / <alpha-value>)',
        },
        // Text that reads on top of the brand color (white, or near-black on a light brand).
        'on-brand': 'rgb(var(--on-brand) / <alpha-value>)',
        canvas: '#f5f6f8',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'Cambria', 'serif'],
      },
    },
  },
  plugins: [],
};
