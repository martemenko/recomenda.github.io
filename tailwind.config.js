/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#12151c',
        surface: '#1b2028',
        surface2: '#222836',
        amber: '#e8a33d',
        amberdim: '#8a6428',
        teal: '#4fa89b',
        tealdim: '#2f6058',
        ink: '#edeef0',
        muted: '#8b92a0',
        danger: '#c96257',
      },
      fontFamily: {
        display: ['Oswald', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
