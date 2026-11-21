// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Math members sim-core may use. Their results are exactly specified, so every JS engine
 * (Node, Chromium, Firefox, WebKit) returns the same bits. Everything else on Math
 * (exp, tanh, sin, cos, pow, log, ...) is approximate and may differ between engines,
 * which silently breaks replays. See docs/master-plan.md §3.3.
 */
const ALLOWED_MATH = ['floor', 'ceil', 'round', 'abs', 'min', 'max', 'sqrt', 'imul', 'fround'];

const PLAN = 'See docs/master-plan.md §3.3.';

/** Globals that make sim-core impure: wall-clock time, entropy, scheduling, host objects. */
const RESTRICTED_GLOBALS = [
  ['Date', 'Wall-clock time is not deterministic. Pass ticks in instead.'],
  ['performance', 'Wall-clock time is not deterministic. Time things in tests/benchmarks only.'],
  ['crypto', 'Use a named RNG stream from rng.ts for randomness.'],
  ['setTimeout', 'sim-core must not schedule work; the caller drives tick().'],
  ['setInterval', 'sim-core must not schedule work; the caller drives tick().'],
  ['setImmediate', 'sim-core must not schedule work; the caller drives tick().'],
  ['requestAnimationFrame', 'sim-core must not schedule work; the caller drives tick().'],
  ['globalThis', 'sim-core must not reach into the host environment.'],
  ['window', 'sim-core has no DOM.'],
  ['self', 'sim-core has no DOM or worker scope.'],
  ['document', 'sim-core has no DOM.'],
  ['navigator', 'sim-core has no DOM.'],
  ['global', 'sim-core must not use Node globals.'],
  ['process', 'sim-core must not use Node globals.'],
].map(([name, message]) => ({ name, message: `${message} ${PLAN}` }));

/**
 * Determinism guard for sim-core runtime code (plan §3.3). Scoped to src/ only:
 * tests and benchmarks may time things or use Math freely.
 */
const simCoreDeterminism = defineConfig({
  name: 'evolution-island/sim-core-determinism',
  files: ['packages/sim-core/src/**/*.ts'],
  rules: {
    // Code built from strings is invisible to the rules below.
    'no-eval': 'error',
    'no-new-func': 'error',
    'no-restricted-globals': ['error', ...RESTRICTED_GLOBALS],
    'no-restricted-properties': [
      'error',
      {
        object: 'Math',
        property: 'random',
        message: `Math.random is not seeded. Use a named RNG stream from rng.ts. ${PLAN}`,
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: `MemberExpression[object.name='Math'][computed=false]:not([property.name=/^(${[...ALLOWED_MATH, 'random'].join('|')})$/])`,
        message: `sim-core may only use Math.${ALLOWED_MATH.join('/')}; other Math functions can differ between JS engines and break replays. ${PLAN}`,
      },
      {
        selector: "MemberExpression[object.name='Math'][computed=true]",
        message: `Computed access on Math hides which function is used. Write Math.<allowed name>. ${PLAN}`,
      },
      {
        selector: ":not(MemberExpression) > Identifier[name='Math']",
        message: `Use Math only as Math.<allowed name> (no aliasing, destructuring or passing it around). ${PLAN}`,
      },
    ],
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@evolution-island/*'],
            message:
              'sim-core is the bottom of the package graph and imports no workspace package.',
          },
          { group: ['node:*'], message: 'sim-core runs in browsers too; no Node built-ins.' },
        ],
      },
    ],
  },
});

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/coverage/',
    '**/playwright-report/',
    '**/test-results/',
    '.claude/',
  ]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    name: 'evolution-island/typescript',
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Numbers in template literals are fine (e.g. `gen ${n}`).
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // noUncheckedIndexedAccess makes every typed-array read `number | undefined`;
      // hot simulation loops use `arr[i]!` after a bounds-checked loop.
      '@typescript-eslint/no-non-null-assertion': 'off',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    name: 'evolution-island/javascript',
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  simCoreDeterminism,

  prettier,
);
