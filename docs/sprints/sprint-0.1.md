# Sprint 0.1 — Repo setup

- **Phase:** 0 — Foundation (`docs/phases/phase-0.md`)
- **Branch:** `sprint-0.1`
- **Personas:** Scrum Master (scope, docs), Simulation Architect (package boundaries, determinism guard), SDET (test + CI wiring)

## Goal

Empty, tested skeleton: four workspace packages that lint, type-check, test and build, with the
`sim-core` determinism rule enforced and proven by a test.

## Backlog

| # | Item | Acceptance |
|---|------|------------|
| 1 | pnpm workspace root (`package.json`, `pnpm-workspace.yaml`, Node/pnpm pins) | `pnpm install` from a clean clone works with `--frozen-lockfile` |
| 2 | Skeleton packages `sim-core`, `shared`, `trainer`, `viewer` (layout per plan §3.2) | Each has `src/index.ts`, a smoke test, `typecheck` and `build` scripts; `trainer` and `viewer` import from `sim-core` and `shared` |
| 3 | TypeScript strict base config | `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`; `sim-core` has no DOM/Node types |
| 4 | ESLint (flat config, typescript-eslint type-aware) + Prettier | `pnpm lint` = ESLint with zero warnings + `prettier --check` |
| 5 | Vitest + fast-check | `pnpm test` runs every package's tests in one run; one fast-check property runs |
| 6 | Playwright | `pnpm test:e2e` builds the viewer, serves the production bundle and checks it loads (Chromium) |
| 7 | **Determinism lint rule** scoped to `packages/sim-core/src` (plan §3.3) | Bans `Math.random`, `Date`, `performance`, `Math.exp/tanh/sin/cos/pow/log` and every other non-allow-listed `Math` member |
| 8 | **Lint fixture test** | Automated test runs the real ESLint config: `Math.random()` (and each other banned pattern) in `sim-core/src` → error; allowed math → no error; same code in `viewer` or `sim-core/test` → no determinism error |
| 9 | GitHub Actions CI | Workflow runs install (frozen lockfile), lint, typecheck, test, build; separate e2e job |
| 10 | Docs | `phase-0.md`, this file, retro section below; `CLAUDE.md` still accurate |

## Definition of done

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass locally on Windows.
- Item 8's test is part of `pnpm test`, so CI keeps proving the rule on every run.
- CI green on GitHub — **only checkable once a remote exists** (not created in this sprint unless the user asks).

## Out of scope

- Any simulation code (RNG, map, config) — Sprint 1.1.
- PixiJS, chunked rendering, `window.__ei` debug hook — Sprint 1.2.
- Nightly cross-engine / slow / perf CI jobs — added with the suites that need them.
- Creating the GitHub remote, pushing, committing — only when the user asks.

## Design notes

See `docs/phases/phase-0.md` → "Architecture decisions" for package direction, the three-layer
`sim-core` purity check, source-condition resolution and toolchain pins.

---

## What was done

All ten backlog items, on branch `sprint-0.1` (not committed or pushed yet).

| Command | Result (Windows 11, Node 24.13, pnpm 12.21) |
|---------|---------------------------------------------|
| `pnpm install --frozen-lockfile` | OK, 138 packages, no build-script approvals needed |
| `pnpm lint` | ESLint 0 problems, Prettier clean |
| `pnpm typecheck` | Root + all 4 packages (`src/` and test/tool configs) clean |
| `pnpm test` | 6 files, **31 tests** passed (~1.7 s), works with no `dist/` present |
| `pnpm build` | sim-core → shared → trainer (tsc), viewer (tsc + Vite 8); `node packages/trainer/dist/cli.js` prints `Evolution Island trainer (sim v0)` |
| `pnpm test:e2e` | 1 Playwright test passed in Chromium |

**Packages** (`packages/*`): `sim-core` exports `SIM_VERSION = 0`; `shared` exports `simVersionLabel()`;
`trainer` has a `banner()` and an `ei-train` bin; `viewer` is a Vite page showing the title and sim
version. Each has a smoke test. `trainer` and `viewer` import both `sim-core` and `shared`, so the
wiring is tested.

**Determinism guard — proof.**
- `packages/sim-core/test/determinism-lint.test.ts` runs the real `eslint.config.js` against 26
  fixtures: `Math.random()` and 21 other banned patterns in `sim-core/src` each produce an error;
  the nine allowed `Math` members produce none; the same banned code in `viewer/src`, `trainer/src`
  and `sim-core/test` produces none. It runs in `pnpm test`, so CI re-proves it on every run.
- Manual check: a real file `packages/sim-core/src/lint-proof.ts` with `Math.random()`,
  `Math.tanh()` and `performance.now()` made `pnpm lint` exit 1 with `no-restricted-properties`,
  `no-restricted-syntax` and `no-restricted-globals` errors; `tsc` independently failed with
  `TS2304: Cannot find name 'performance'` (no DOM/Node types in `sim-core/src`). File removed after.

**CI**: `.github/workflows/ci.yml` — `checks` job (frozen install, lint, typecheck, test, build) and
`e2e` job (Playwright Chromium, report uploaded on failure). Runs on pushes to `main`, pull requests
and manual dispatch. **Not yet observed running**: the branch has not been pushed.

## Retro

**Went well**
- Source-condition `exports` (`@evolution-island/source`) mean tests and type-checks never need a
  build, while `pnpm build` still produces plain JS that Node runs. One mechanism, no path aliases.
- The determinism rule has two independent layers (ESLint + the `sim-core` tsconfig having no
  DOM/Node types) and a test proving both directions: it fires where it must and stays quiet elsewhere.
- Everything ran first time after install except two Prettier line-width nits.

**Surprises / learnings**
- TypeScript 7 (native) is `latest`, but typescript-eslint 8 supports only `<6.1`, so TypeScript is
  pinned to `~6.0.3`. Revisit when typescript-eslint supports 7.
- Very new majors (pnpm 12, Vite 8 with Rolldown, Vitest 5, ESLint 10) needed no workarounds.
- `playwright install` pruned two older Chromium builds from the machine-wide cache
  (`%LOCALAPPDATA%\ms-playwright`). Harmless (other projects re-download on their next install) but a
  machine-level side effect worth knowing.
- A GitHub remote (`origin`) and an MIT `LICENSE` commit on `main` appeared during the sprint, made
  outside this session; `sprint-0.1` is based on that commit.
- Added `no-eval` / `no-new-func` to the `sim-core` block: code in strings would bypass every other
  rule.

**Not done / open**
- CI green on GitHub is unverified until `sprint-0.1` is pushed (user's call).
- Known limits of the lint guard: it can't see into third-party code (Sprint 1.1 must vet
  `simplex-noise` against the math rules or vendor it, plan §3.3), and it can't check ordering rules
  (stable sorts, ties by id) — those need the state-hash determinism tests from Sprint 1.1.
- No README with the commands yet; `CLAUDE.md` is still accurate and was left unchanged.

**Next sprint (1.1) should start with:** `rng.ts` (sfc32 + named streams), `config.ts`, `hash.ts`
and a same-seed-same-hash test before any map code.
