/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0f033b',
        surface: '#170a4a',
        surface2: '#241259',
        amber: '#f3c255',
        teal: '#dd0df4',
        ink: '#edeef0',
        muted: '#9791c2',
        danger: '#db1391',
        heart: '#ff4b5c',
      },
      fontFamily: {
        display: ['Fredoka', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
