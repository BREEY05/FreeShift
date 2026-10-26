/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--fs-canvas)',
        surface: 'var(--fs-surface)',
        line: 'var(--fs-line)',
        ink: 'var(--fs-ink)',
        muted: 'var(--fs-muted)',
        subtle: 'var(--fs-subtle)',
        brand: {
          DEFAULT: 'var(--fs-brand)',
          hover: 'var(--fs-brand-hover)',
          soft: 'var(--fs-brand-soft)',
        },
        mint: 'var(--fs-mint)',
        amber: 'var(--fs-amber)',
        danger: 'var(--fs-danger)',
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans SC', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
        control: '8px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.06)',
        lift: '0 8px 24px rgba(16, 24, 40, 0.12)',
      },
      fontSize: {
        '2xs': ['11px', '16px'],
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(24px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        'pop-in': {
          from: { transform: 'translateY(6px) scale(0.98)', opacity: '0' },
          to: { transform: 'translateY(0) scale(1)', opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-in-right': 'slide-in-right 160ms ease-out',
        'pop-in': 'pop-in 140ms ease-out',
      },
    },
  },
  plugins: [],
};
