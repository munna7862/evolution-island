# Evolution Island

A browser simulation where tribes of small AI creatures start knowing nothing and, through neuroevolution, learn to find food and water, hold territory, help their tribe and fight rivals. No strategy is hand-coded. You watch them evolve.

**Watch it:** https://munna7862.github.io/evolution-island/ — pick a run under **Trained** to see champions trained in advance, or generate any map from a seed. **Copy link** shares the map, or the trained run and generation, you are watching.

## What's inside

| Package | What it is |
|---------|------------|
| `packages/sim-core` | The deterministic simulation: map generation, creatures, sensors, brains (MLP or NEAT), the genetic algorithm, climate and disasters. Same seed, config and sim version → the same world in Node and in every major browser. |
| `packages/shared` | File formats (runs, checkpoints, replays, featured runs) and the viewer–worker protocol. |
| `packages/trainer` | Headless Node CLI: trains, resumes, analyses, benchmarks and publishes runs. |
| `packages/viewer` | The static web viewer (PixiJS; the simulation runs in a Web Worker): dashboard, inspector, family tree, world events, replays. |

## Quick start

Requires Node 24 and pnpm (the version in `package.json`).

```sh
pnpm install
pnpm --filter @evolution-island/viewer dev       # the viewer at http://localhost:5173
pnpm train --preset medium --seed 42 --generations 300 --out runs/medium-42
```

Load the run folder in the viewer with **Load run…** (or drop it on the map) to watch its champions.

| Command | What it does |
|---------|--------------|
| `pnpm train` | Train a run (`--seeds 1-10` for several, `--config file.json` to change settings, `--resume dir`) |
| `pnpm analyze --runs dir` | Who won, lock-in, champions' action mix, mute tests |
| `pnpm replay export / verify` | Replay files that re-run a world bit for bit |
| `pnpm bench` | Worst-case speed against the performance targets |
| `pnpm featured run...` | Publish trained runs with the viewer (`packages/viewer/public/runs`) |
| `pnpm test`, `pnpm test:browser`, `pnpm test:e2e` | Unit tests; golden hashes in Chromium, Firefox and WebKit; viewer end-to-end |

## Share links

`?preset=large&seed=1234&v=15` opens the same map on any machine running simulation version 15 (`&run=medium-42&gen=150` opens a featured run at a saved generation). A link made by another version still opens, with a note that the world may differ.

## Docs

The plan and every design decision: [`docs/master-plan.md`](docs/master-plan.md). Phases and sprints, with what was measured and why: [`docs/phases`](docs/phases), [`docs/sprints`](docs/sprints). The NEAT vs MLP comparison: [`docs/neat-vs-mlp.md`](docs/neat-vs-mlp.md).

## License

[MIT](LICENSE)
