/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './client/index.html',
    './client/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand palette pulled from bestroofingnow.com.
        // `blue` is intentionally remapped to the brand navy so the app's
        // existing `blue-*` primary usages retheme to navy automatically.
        blue: {
          50: '#eef1f7',
          100: '#dbe1ef',
          200: '#b6c2df',
          300: '#8697c4',
          400: '#566aa0',
          500: '#2f4480',
          600: '#0e1f57', // primary navy
          700: '#0b1949',
          800: '#081134',
          900: '#060d26',
          950: '#0b1220',
        },
        navy: { DEFAULT: '#0e1f57', dark: '#081134', deep: '#0b1220' },
        brick: { DEFAULT: '#b8322b', light: '#c84a42', dark: '#8e231e' }, // accent / key CTAs
        gold: '#d8a852',
        cream: '#f5f1ea',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'Cambria', 'serif'],
      },
    },
  },
  plugins: [],
};
