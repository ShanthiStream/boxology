/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#08090A',
        panel: '#0F1013',
        raise: '#15171B',
        line: '#23262C',
        text: '#EDEEF0',
        mute: '#8B8F99',
        accent: '#D8FF3E',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Instrument Serif"', 'ui-serif', 'Georgia', 'serif'],
      },
      letterSpacing: {
        tightest: '-0.045em',
      },
    },
  },
  plugins: [],
};
