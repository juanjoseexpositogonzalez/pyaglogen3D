import type { Config } from 'tailwindcss'

/**
 * Every value here derives from the custom properties declared in
 * `src/app/globals.css`. No literal colour may appear in this file.
 *
 * `darkMode` is anchored to the `data-theme` attribute rather than left at its
 * default of `media`. The codebase carries 38 `dark:` utilities; under `media`
 * they would follow the operating system and paint dark surfaces onto the new
 * light canvas. Anchored, they stay dormant until the theme script writes the
 * attribute. Dormant beats broken.
 */
const config: Config = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // shadcn bridge, HSL channel tokens
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent-surface))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',

        // design-system tokens, direct values
        canvas: {
          DEFAULT: 'var(--canvas)',
          deep: 'var(--canvas-deep)',
        },
        surface: {
          DEFAULT: 'var(--surface)',
          strong: 'var(--surface-strong)',
          soft: 'var(--surface-soft)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          strong: 'var(--ink-strong)',
          muted: 'var(--ink-muted)',
          faint: 'var(--ink-faint)',
          'on-dark': 'var(--ink-on-dark)',
          'on-dark-soft': 'var(--ink-on-dark-soft)',
          'on-dark-faint': 'var(--ink-on-dark-faint)',
        },
        brand: {
          DEFAULT: 'var(--accent)',
          strong: 'var(--accent-strong)',
          bright: 'var(--accent-bright)',
          cyan: 'var(--brand-cyan)',
          soft: 'var(--accent-soft)',
          mint: 'var(--mint)',
        },
        series: {
          1: 'var(--series-1)',
          2: 'var(--series-2)',
          3: 'var(--series-3)',
          4: 'var(--series-4)',
          5: 'var(--series-5)',
          6: 'var(--series-6)',
        },
        success: {
          DEFAULT: 'var(--success)',
          soft: 'var(--success-soft)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          soft: 'var(--warning-soft)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          soft: 'var(--danger-soft)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        visual: {
          DEFAULT: 'var(--visual-background)',
          border: 'var(--visual-border)',
          caption: 'var(--visual-caption-background)',
          grid: 'var(--visual-grid)',
        },
      },
      backgroundImage: {
        shell: 'var(--shell-background)',
        card: 'var(--card-gradient)',
        'panel-teal': 'var(--panel-gradient-teal)',
        'panel-violet': 'var(--panel-gradient-violet)',
        'panel-gold': 'var(--panel-gradient-gold)',
        'panel-navy': 'var(--panel-gradient-navy)',
        'panel-slate': 'var(--panel-gradient-slate)',
      },
      boxShadow: {
        panel: 'var(--shadow)',
        deep: 'var(--shadow-deep)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
}
export default config
