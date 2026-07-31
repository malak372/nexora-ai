/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
  ],

  theme: {
    extend: {
      colors: {
        nexora: {
          primary: '#7C5CC4',
          secondary: '#5FA8D3',
          accent: '#D98CB3',
          text: '#241D35',
          muted: '#746D84',
          background: '#FAF8FF',
          surface: '#FFFFFF',
          lavender: '#EEE8FF',
          sky: '#EAF7FF',
          pink: '#FFF0F7',
          border: '#E7DFF4',
        },
      },

      boxShadow: {
        soft: '0 18px 45px rgba(94, 70, 135, 0.12)',
        card: '0 24px 60px rgba(93, 70, 133, 0.14)',
        button: '0 14px 30px rgba(117, 86, 190, 0.25)',
      },

      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },

      backgroundImage: {
        'nexora-gradient':
          'linear-gradient(110deg, #7658CA 0%, #9470D9 48%, #609FD4 100%)',

        'nexora-light-gradient':
          'linear-gradient(135deg, #FFFDFE 0%, #F8F4FF 45%, #EEF8FF 100%)',

        'nexora-card-gradient':
          'linear-gradient(145deg, rgba(255,255,255,0.96), rgba(247,242,255,0.82))',
      },

      fontFamily: {
        sans: [
          'Inter',
          'Poppins',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
      },

      keyframes: {
        float: {
          '0%, 100%': {
            transform: 'translateY(0)',
          },
          '50%': {
            transform: 'translateY(-12px)',
          },
        },

        pulseSoft: {
          '0%, 100%': {
            opacity: '0.7',
            transform: 'scale(1)',
          },
          '50%': {
            opacity: '1',
            transform: 'scale(1.06)',
          },
        },

        gradientMove: {
          '0%': {
            backgroundPosition: '0% 50%',
          },
          '50%': {
            backgroundPosition: '100% 50%',
          },
          '100%': {
            backgroundPosition: '0% 50%',
          },
        },
      },

      animation: {
        float: 'float 6s ease-in-out infinite',
        'pulse-soft': 'pulseSoft 5s ease-in-out infinite',
        'gradient-move': 'gradientMove 8s ease infinite',
      },
    },
  },

  plugins: [],
};