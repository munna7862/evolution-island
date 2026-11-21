/**
 * Proves the sim-core determinism lint rule (plan §3.3, eslint.config.js) actually fires.
 *
 * Each case lints a code fixture with the repo's real ESLint config, as if the code lived at the
 * given path. Type-aware rules are switched off here (fixtures are virtual files, not part of any
 * tsconfig); the determinism rules are purely syntactic, so they behave exactly as in `pnpm lint`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SIM_CORE_SRC = 'packages/sim-core/src/fixture.ts';

const DETERMINISM_RULES = new Set([
  'no-eval',
  'no-new-func',
  'no-restricted-globals',
  'no-restricted-properties',
  'no-restricted-syntax',
  'no-restricted-imports',
]);

const eslint = new ESLint({
  cwd: REPO_ROOT,
  overrideConfig: tseslint.configs.disableTypeChecked,
});

interface LintOutcome {
  /** Rule ids of determinism errors, in source order. */
  readonly determinism: readonly string[];
  /** All error messages, for readable assertion failures. */
  readonly messages: readonly string[];
}

async function lint(code: string, relativePath: string): Promise<LintOutcome> {
  const results = await eslint.lintText(code, { filePath: path.join(REPO_ROOT, relativePath) });
  const messages = results.flatMap((result) => result.messages);
  const fatal = messages.filter((message) => message.fatal === true);
  expect(fatal, 'fixture must parse').toEqual([]);
  return {
    determinism: messages
      .filter((message) => message.severity === 2 && DETERMINISM_RULES.has(message.ruleId ?? ''))
      .map((message) => message.ruleId ?? ''),
    messages: messages.map((message) => `${message.ruleId ?? 'fatal'}: ${message.message}`),
  };
}

beforeAll(async () => {
  // Loading the config (typescript-eslint and friends) is the slow part; do it once.
  await eslint.calculateConfigForFile(path.join(REPO_ROOT, SIM_CORE_SRC));
}, 60_000);

describe('sim-core determinism lint rule', () => {
  it('rejects Math.random() in sim-core/src', async () => {
    const outcome = await lint('export const roll = Math.random();\n', SIM_CORE_SRC);
    expect(outcome.determinism, outcome.messages.join('\n')).toContain('no-restricted-properties');
    expect(outcome.messages.join('\n')).toMatch(/named RNG stream/);
  });

  it.each([
    ['Date.now()', 'export const t = Date.now();', 'no-restricted-globals'],
    ['new Date()', 'export const d = new Date();', 'no-restricted-globals'],
    ['performance.now()', 'export const t = performance.now();', 'no-restricted-globals'],
    ['crypto entropy', 'export const c = crypto.randomUUID();', 'no-restricted-globals'],
    ['timers', 'setTimeout(() => undefined, 0);', 'no-restricted-globals'],
    ['globalThis.Math', 'export const r = globalThis.Math.random();', 'no-restricted-globals'],
    ['DOM', 'export const el = document.body;', 'no-restricted-globals'],
    ['Math.exp', 'export const v = Math.exp(1);', 'no-restricted-syntax'],
    ['Math.tanh', 'export const v = Math.tanh(1);', 'no-restricted-syntax'],
    ['Math.sin', 'export const v = Math.sin(1);', 'no-restricted-syntax'],
    ['Math.cos', 'export const v = Math.cos(1);', 'no-restricted-syntax'],
    ['Math.pow', 'export const v = Math.pow(2, 3);', 'no-restricted-syntax'],
    ['Math.log', 'export const v = Math.log(2);', 'no-restricted-syntax'],
    ['other Math (atan2)', 'export const v = Math.atan2(1, 2);', 'no-restricted-syntax'],
    ['computed Math access', "export const v = Math['random']();", 'no-restricted-syntax'],
    ['aliasing Math', 'const M = Math;\nexport const v = M.exp(1);', 'no-restricted-syntax'],
    [
      'destructuring Math',
      'const { exp } = Math;\nexport const v = exp(1);',
      'no-restricted-syntax',
    ],
    ['workspace import', "export { x } from '@evolution-island/shared';", 'no-restricted-imports'],
    ['Node built-in', "export { readFileSync } from 'node:fs';", 'no-restricted-imports'],
    ['eval', "export const v: unknown = eval('Math.random()');", 'no-eval'],
    ['new Function', "export const f = new Function('return Math.random()');", 'no-new-func'],
  ])('rejects %s in sim-core/src', async (_label, code, ruleId) => {
    const outcome = await lint(`${code}\n`, SIM_CORE_SRC);
    expect(outcome.determinism, outcome.messages.join('\n')).toContain(ruleId);
  });

  it('allows the engine-independent Math members', async () => {
    const code = [
      'export function mix(a: number, b: number): number {',
      '  return Math.floor(a) + Math.ceil(b) + Math.round(a) + Math.abs(b) + Math.min(a, b) +',
      '    Math.max(a, b) + Math.sqrt(a) + Math.imul(a, b) + Math.fround(b);',
      '}',
      '',
    ].join('\n');
    const outcome = await lint(code, SIM_CORE_SRC);
    expect(outcome.determinism, outcome.messages.join('\n')).toEqual([]);
  });

  it.each([
    ['viewer', 'packages/viewer/src/fixture.ts'],
    ['trainer', 'packages/trainer/src/fixture.ts'],
    ['sim-core tests', 'packages/sim-core/test/fixture.test.ts'],
  ])('does not apply outside sim-core/src (%s)', async (_label, relativePath) => {
    const code = 'export const roll = Math.random() + Math.exp(1) + Date.now();\n';
    const outcome = await lint(code, relativePath);
    expect(outcome.determinism, outcome.messages.join('\n')).toEqual([]);
  });
});
