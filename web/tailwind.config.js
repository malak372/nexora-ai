/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
  ],

  theme: {
    extend: {
      colors: {
        nexora: {
          background: '#F7F3ED',
          surface: '#FFFFFF',
          cream: '#EDE4D8',
          primary: '#5B4B8A',
          primaryDark: '#403464',
          secondary: '#8D6E63',
          accent: '#7A9E9F',
          text: '#28231F',
          muted: '#716A64',
          border: '#E3DBD1',
          success: '#3E8062',
          warning: '#C68A35',
          danger: '#B75454',
        },
      },

      fontFamily: {
        sans: ['Inter', 'Arial', 'sans-serif'],
        arabic: ['Cairo', 'Arial', 'sans-serif'],
      },

      boxShadow: {
        card: '0 12px 40px rgba(40, 35, 31, 0.08)',
        soft: '0 8px 24px rgba(40, 35, 31, 0.06)',
      },

      borderRadius: {
        nexora: '1.5rem',
      },

      backgroundImage: {
        'nexora-gradient':
          'linear-gradient(135deg, #5B4B8A 0%, #7A9E9F 100%)',
      },
    },
  },

  plugins: [],
};

