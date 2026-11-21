# Phase 0 — Foundation

> Source of truth: `docs/master-plan.md` §4 (Phase 0), §3.1–3.3 (stack, repo layout, key rules), §5 (testing).

## Goal

An empty but fully wired monorepo where every later sprint can add code without touching tooling:
one command each to lint, type-check, test and build, a CI pipeline that runs them, and the
**determinism guard-rails for `sim-core` enforced by tooling from day one** — not by memory.

## Sprints

| Sprint | Title      | Outcome |
|--------|------------|---------|
| 0.1    | Repo setup | pnpm workspaces, 4 skeleton packages, TS strict, ESLint + Prettier, Vitest + fast-check, Playwright, GitHub Actions CI, ESLint determinism rule for `sim-core` with a test that proves it fires |

Phase 0 has a single sprint. `CLAUDE.md` (plan §7) already exists, so Sprint 0.1 only checks it is
still accurate.

## Exit criteria (Phase 0 is done when)

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass on a clean checkout.
2. A `Math.random()` call in `packages/sim-core/src` fails lint, proven by an automated test that runs
   the real ESLint config against fixtures (plan §4: "a `Math.random()` call in `sim-core` fails lint").
3. The CI workflow runs the same commands on every push to `main` and on every pull request.
   *(Can only be observed once a GitHub remote exists — the remote is the user's call.)*
4. `docs/sprints/sprint-0.1.md` has the "what was done" section and retro notes.

## Architecture decisions taken in this phase

These are clarifications of the plan, not changes to it.

1. **Package dependency direction:** `sim-core` ← `shared` ← `trainer`, `viewer`
   (`trainer` and `viewer` also import `sim-core` directly). `sim-core` depends on nothing in the
   workspace, so it can never pull in rendering, Node or DOM code by accident (plan §3.3 "Separation").
   `shared` holds what more than one consumer needs (serialization, worker protocol — plan §3.2), and
   may import `sim-core` types.
2. **`sim-core` is checked three ways for purity:**
   - its `tsconfig` has `lib: ["ES2023"]` and `types: []` — no DOM and no Node globals exist for it
     at all, so `document`, `window`, `process`, `performance` are type errors;
   - an ESLint block scoped to `packages/sim-core/src/**` bans `Math.random`, `Date`, `performance`,
     timers, `crypto`, global-object access, `eval` / `new Function`, and every `Math.*` member
     outside the plan's allow-list (`floor ceil round abs min max sqrt imul fround`);
   - `no-restricted-imports` stops `sim-core/src` importing other workspace packages or `node:*`.
   Tests and benchmarks under `packages/sim-core/test` are **not** restricted (they may time things).
3. **Internal packages resolve to source during development.** Each package's `exports` has a custom
   condition `@evolution-island/source` → `src/index.ts`, used by `tsc --noEmit`, Vitest and Vite, so
   tests and type-checks never need a prior build. `pnpm build` ignores that condition and builds
   packages in dependency order to `dist/` (so the Node trainer runs plain JS).
4. **Toolchain pins** (latest stable that work together, Nov 2026): Node 24 LTS, pnpm 12,
   TypeScript **6.0** (not 7 — typescript-eslint supports `<6.1`), ESLint 10 flat config +
   typescript-eslint 8 (type-aware), Prettier 3, Vitest 5 (one root run over per-package projects),
   fast-check 4, Vite 8, Playwright 1.65.
5. **CI shape:** one `checks` job (lint, typecheck, test, build) and one `e2e` job (Playwright
   Chromium smoke test against the built viewer). Cross-engine (Firefox/WebKit), slow and perf suites
   are nightly jobs added in later sprints (plan §5).

## Risks

| Risk | Mitigation |
|------|------------|
| Very new major versions (pnpm 12, Vite 8, Vitest 5, ESLint 10) behave differently from what docs/examples show | Pin exact-major ranges, commit the lockfile, keep config minimal and verified by running every command locally |
| Determinism rule has holes (aliasing `Math`, computed access, `globalThis.Math`) | Fixture test covers each bypass pattern; the TS `lib`/`types` restriction is a second, independent guard |
| Lint rule too broad (flags allowed math or test code) | Fixture test also asserts allowed math and test/viewer files produce **no** determinism errors |
| Playwright browsers are large downloads | `pnpm test` stays browser-free; e2e is its own script and CI job |
