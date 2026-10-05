// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Shufflerr design tokens: every color resolves to a CSS variable defined in
// src/styles/globals.css so dark (default) and light themes share one class set.
// Seerr's gray/indigo scales are remapped onto the tokens so inherited
// components pick up the Shufflerr look without per-file rewrites.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

const tokenColors = {
  bg: v('bg'),
  surface: v('surface'),
  raised: v('raised'),
  hover: v('hover'),
  line: v('line'),
  'line-2': v('line-2'),
  ink: v('text'),
  muted: v('muted'),
  faint: v('faint'),
  accent: v('accent'),
  'on-accent': v('on-accent'),
  link: v('link'),
  rail: v('rail'),
  slot: v('slot'),
  'slot-ink': v('slot-ink'),
  st: {
    available: v('st-available'),
    partial: v('st-partial'),
    processing: v('st-processing'),
    pending: v('st-pending'),
    declined: v('st-declined'),
    none: v('st-none'),
  },
  brand: {
    plex: '#E5A00D',
    'plex-ink': '#1B1405',
    jellyfin: '#7B5CD6',
    spotify: '#1DB954',
    deezer: '#A238FF',
    itunes: '#FB5BC5',
    ticketmaster: '#026CDF',
    youtube: '#E62117',
    lastfm: '#D51007',
    listenbrainz: '#EB743B',
    musicbrainz: '#BA478F',
    navidrome: '#2F6FDE',
  },
  // Seerr scales remapped to tokens
  gray: {
    50: v('text'),
    100: v('text'),
    200: v('text'),
    300: v('text'),
    400: v('muted'),
    500: v('faint'),
    600: v('line-2'),
    700: v('raised'),
    800: v('surface'),
    900: v('bg'),
    950: v('rail'),
  },
  indigo: {
    50: v('link'),
    100: v('link'),
    200: v('link'),
    300: v('link'),
    400: v('link'),
    500: v('accent'),
    600: v('accent'),
    700: v('accent'),
    800: v('accent'),
    900: v('accent'),
  },
};

const lineGray = {
  50: v('line-2'),
  100: v('line-2'),
  200: v('line-2'),
  300: v('line-2'),
  400: v('line-2'),
  500: v('line-2'),
  600: v('line-2'),
  700: v('line'),
  800: v('line'),
  900: v('line'),
  950: v('line'),
};

module.exports = {
  mode: 'jit',
  content: [
    './node_modules/@seerr-team/react-tailwindcss-datepicker/dist/index.esm.js',
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      transitionProperty: {
        'max-height': 'max-height',
        width: 'width',
      },
      colors: tokenColors,
      borderColor: { gray: lineGray, DEFAULT: v('line') },
      divideColor: { gray: lineGray },
      ringColor: { gray: lineGray },
      borderRadius: {
        ctl: '8px',
        pill: '12px',
        panel: '14px',
        hero: '16px',
      },
      fontSize: {
        base: ['15px', '1.5'],
      },
      maxWidth: {
        view: '1400px',
      },
      screens: {
        rail: '761px',
        admin: '981px',
      },
      fontFamily: {
        sans: ['IBM Plex Sans', ...defaultTheme.fontFamily.sans],
        mono: ['JetBrains Mono', ...defaultTheme.fontFamily.mono],
      },
      typography: (theme) => ({
        DEFAULT: {
          css: {
            color: 'rgb(var(--c-text))',
            a: {
              color: 'rgb(var(--c-link))',
              '&:hover': {
                color: 'rgb(var(--c-link))',
              },
            },

            h1: {
              color: 'rgb(var(--c-text))',
            },
            h2: {
              color: 'rgb(var(--c-text))',
            },
            h3: {
              color: 'rgb(var(--c-text))',
            },
            h4: {
              color: 'rgb(var(--c-text))',
            },
            h5: {
              color: 'rgb(var(--c-text))',
            },
            h6: {
              color: 'rgb(var(--c-text))',
            },

            strong: {
              color: 'rgb(var(--c-muted))',
            },

            code: {
              color: 'rgb(var(--c-text))',
            },

            figcaption: {
              color: 'rgb(var(--c-faint))',
            },
          },
        },
      }),
    },
    aspectRatio: {
      auto: 'auto',
      square: '1 / 1',
      video: '16 / 9',
      1: '1',
      2: '2',
      3: '3',
      4: '4',
      5: '5',
      6: '6',
      7: '7',
      8: '8',
      9: '9',
      10: '10',
      11: '11',
      12: '12',
      13: '13',
      14: '14',
      15: '15',
      16: '16',
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/aspect-ratio'),
  ],
};
