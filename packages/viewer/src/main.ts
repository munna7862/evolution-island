import {
  featuredRunsPlayable,
  formatSpeed,
  parseReplay,
  type CreatureInspection,
  type FeaturedRunsManifest,
  type InspectTarget,
  parseSeed,
  SIM_SPEEDS,
  type MainToWorkerMessage,
  type ReplayStatus,
  type SimSnapshot,
  type SimSpeed,
  type TransferableMapData,
  type WorkerToMainMessage,
} from '@evolution-island/shared';
import {
  type LineageTree,
  brainSpecFromConfig,
  DEFAULT_CONFIG,
  hashConfig,
  MAP_PRESETS,
  SIM_VERSION,
  type EvolutionStart,
  type MapPresetId,
  type Seed,
  type WorldEvent,
  type WorldEventKind,
} from '@evolution-island/sim-core';
import type {
  EvolutionIslandDebugHook,
  EvolutionIslandDebugState,
  PlayingCheckpoint,
} from './debug-hook.js';
import type { TileCoord } from './renderer/camera.js';
import { climateAt, climateSummary } from './renderer/climate-overlay.js';
import { MapView } from './renderer/map-view.js';
import { BIOME_LEGEND, BIOME_NAMES, tribeHex, tribeName } from './renderer/palette.js';
import { sourcesFromDrop, sourcesFromFileList } from './run-drop.js';
import {
  featuredBaseUrl,
  featuredSources,
  fetchFeaturedRuns,
  fetchTextOrThrow,
} from './featured.js';
import { readShareParams, shareUrl, versionNotice } from './share-link.js';
import {
  checkpointsOfRun,
  defaultCheckpoint,
  loadCheckpoint,
  onlyTribe,
  runName,
  runNames,
  scanRunFiles,
  type FoundCheckpoint,
  type RunFileSource,
} from './run-loader.js';
import { chartPaths, DashboardData, type ChartMetric } from './dashboard.js';
import { statusLine } from './status.js';
import './styles.css';

/** How the HUD names each world event (Sprint 7.2). */
const EVENT_LABELS: Record<WorldEventKind, string> = {
  drought: 'drought',
  flood: 'flood',
  winter: 'winter',
  foodZone: 'food zone',
};

interface ExportRequestEntry {
  readonly resolve: (text: string) => void;
  readonly reject: (reason: Error) => void;
}

interface HashRequestEntry {
  readonly resolve: (result: { readonly tick: number; readonly worldHash: string }) => void;
  readonly reject: (reason: Error) => void;
}

interface InitialParams {
  readonly preset: MapPresetId;
  readonly seed: Seed;
  readonly running: boolean;
  readonly speed: SimSpeed;
  /** Phase 10 share links: the simVersion the link was made with, and a featured run. */
  readonly linkVersion: number | null;
  readonly run: string | null;
  readonly generation: number | null;
}

interface HudTribeNode {
  readonly item: HTMLSpanElement;
  readonly swatch: HTMLSpanElement;
  readonly label: HTMLSpanElement;
}

function requireEl<T extends Element>(selector: string, ctor: abstract new () => T): T {
  const el = document.querySelector(selector);
  if (el === null || !(el instanceof ctor)) {
    throw new Error(`Missing required DOM element: ${selector}`);
  }
  return el;
}

function isMapPresetId(value: string | null): value is MapPresetId {
  return value !== null && Object.prototype.hasOwnProperty.call(MAP_PRESETS, value);
}

function parseSpeedParam(raw: string | null): SimSpeed {
  if (raw === null) return 1;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'max') return 'max';
  const num = Number(trimmed);
  for (const candidate of SIM_SPEEDS) {
    if (candidate === num) return candidate;
  }
  return 1;
}

function readInitialParams(): InitialParams {
  const params = new URLSearchParams(window.location.search);
  const share = readShareParams(window.location.search);
  const paused = params.get('paused');
  return {
    preset: share.preset ?? 'medium',
    seed: share.seed ?? 42,
    running: paused !== '1' && paused !== 'true',
    speed: parseSpeedParam(params.get('speed')),
    linkVersion: share.simVersion,
    run: share.run,
    generation: share.generation,
  };
}

/** Keeps the address bar a shareable link of what plays (Phase 10). */
function syncUrlParams(
  preset: MapPresetId,
  seed: Seed,
  run: string | null,
  generation: number | null,
): void {
  window.history.replaceState(
    null,
    '',
    shareUrl(window.location.href, { preset, seed, run, generation }),
  );
}

function renderLegend(legendEl: HTMLElement): void {
  const items = BIOME_LEGEND.map((item) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = item.hex;
    const label = document.createElement('span');
    label.textContent = item.label;
    wrapper.append(swatch, label);
    return wrapper;
  });
  legendEl.replaceChildren(...items);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showFatalError(message: string): void {
  const host = document.querySelector('#viewport') ?? document.body;
  const banner = document.createElement('div');
  banner.className = 'fatal-error';
  banner.textContent = `Viewer error: ${message}`;
  host.replaceChildren(banner);
}

async function boot(): Promise<void> {
  const statusBadge = requireEl('#status-badge', HTMLElement);
  const form = requireEl('#map-controls', HTMLFormElement);
  const presetSelect = requireEl('#preset-select', HTMLSelectElement);
  const seedInput = requireEl('#seed-input', HTMLInputElement);
  const randomBtn = requireEl('#random-btn', HTMLButtonElement);
  const overlaysToggle = requireEl('#overlays-toggle', HTMLInputElement);
  const resetViewBtn = requireEl('#reset-view-btn', HTMLButtonElement);
  const playPauseBtn = requireEl('#play-pause-btn', HTMLButtonElement);
  const stepBtn = requireEl('#step-btn', HTMLButtonElement);
  const speedControlsEl = requireEl('#speed-controls', HTMLElement);
  const speedButtons = Array.from(
    speedControlsEl.querySelectorAll<HTMLButtonElement>('.speed-btn'),
  );
  const eventButtons = Array.from(
    requireEl('#event-controls', HTMLElement).querySelectorAll<HTMLButtonElement>('.event-btn'),
  );
  const hudClimateEl = requireEl('#hud-climate', HTMLElement);
  // World events (Sprint 7.2): a drought, flood or food zone waits for a click on the map.
  let armedEvent: 'drought' | 'flood' | 'foodZone' | null = null;
  const viewport = requireEl('#viewport', HTMLElement);
  const mapStatsEl = requireEl('#map-stats', HTMLElement);
  const hoverInfoEl = requireEl('#hover-info', HTMLElement);
  const legendEl = requireEl('#legend', HTMLElement);
  const hudTickEl = requireEl('#hud-tick', HTMLElement);
  const hudGenEl = requireEl('#hud-generation', HTMLElement);
  const hudTpsEl = requireEl('#hud-tps', HTMLElement);
  const hudPopEl = requireEl('#hud-population', HTMLElement);
  const hudTribesEl = requireEl('#hud-tribes', HTMLElement);
  const dashboardEl = requireEl('#dashboard', HTMLElement);
  const dashGenerationEl = requireEl('#dash-generation', HTMLElement);
  const dashRowsEl = requireEl('#dash-rows', HTMLElement);
  const chartCanvases = {
    avgFitness: requireEl('#chart-fitness', HTMLCanvasElement),
    benchmarkScore: requireEl('#chart-benchmark', HTMLCanvasElement),
    population: requireEl('#chart-population', HTMLCanvasElement),
  } as const;
  const dashboard = new DashboardData(tribeName);
  const dashFeedEl = requireEl('#dash-feed', HTMLElement);
  const dashTreeEl = requireEl('#dash-tree', HTMLElement);
  const dashTreeTitleEl = requireEl('#dash-tree-title', HTMLElement);
  // Family tree (Sprint 6.3): the tribe shown (null = the leader) and the latest tree.
  let treeTribe: number | null = null;
  let latestTree: LineageTree | null = null;
  let nextLineageRequestId = 1;
  const inspectorEl = requireEl('#inspector', HTMLElement);
  const inspTitleEl = requireEl('#insp-title', HTMLElement);
  const inspStatsEl = requireEl('#insp-stats', HTMLElement);
  const inspBrainEl = requireEl('#insp-brain', HTMLElement);
  const inspInputsEl = requireEl('#insp-inputs', HTMLElement);
  const inspFollow = requireEl('#insp-follow', HTMLInputElement);
  const inspClose = requireEl('#insp-close', HTMLButtonElement);
  // Inspector (Sprint 6.2): what is inspected, and the latest data the worker sent for it.
  let inspectTarget: InspectTarget = null;
  let latestInspection: CreatureInspection | null = null;
  const loadRunBtn = requireEl('#load-run-btn', HTMLButtonElement);
  const runInput = requireEl('#run-input', HTMLInputElement);
  const loadReplayBtn = requireEl('#load-replay-btn', HTMLButtonElement);
  const replayInput = requireEl('#replay-input', HTMLInputElement);
  const exportReplayBtn = requireEl('#export-replay-btn', HTMLButtonElement);
  const checkpointField = requireEl('#checkpoint-field', HTMLElement);
  const checkpointSelect = requireEl('#checkpoint-select', HTMLSelectElement);
  const runField = requireEl('#run-field', HTMLElement);
  const runSelect = requireEl('#run-select', HTMLSelectElement);
  const tribeField = requireEl('#tribe-field', HTMLElement);
  const tribeSelect = requireEl('#tribe-select', HTMLSelectElement);
  const runInfoEl = requireEl('#run-info', HTMLElement);
  const featuredSelect = requireEl('#featured-select', HTMLSelectElement);
  const copyLinkBtn = requireEl('#copy-link-btn', HTMLButtonElement);
  const dropOverlay = requireEl('#drop-overlay', HTMLElement);

  statusBadge.textContent = statusLine();
  renderLegend(legendEl);

  const initial = readInitialParams();
  presetSelect.value = initial.preset;
  seedInput.value = String(initial.seed);

  let currentMap: TransferableMapData | null = null;
  let currentSeed: Seed = initial.seed;
  let latestSnapshot: SimSnapshot | null = null;
  let desiredRunning = initial.running;
  let desiredSpeed: SimSpeed = initial.speed;
  let lastControlSeq = 0;
  let activeRunId = 0;
  let renderCount = 0;
  let nextHashRequestId = 1;
  const pendingHashRequests = new Map<number, HashRequestEntry>();
  let hudTribeNodes: HudTribeNode[] = [];

  // Loaded run (Sprint 3.3): the picked/dropped files, the checkpoints found in them, and the
  // one being played (null in random mode).
  const expectedCheckpoint = {
    brain: brainSpecFromConfig(DEFAULT_CONFIG),
    configHash: hashConfig(DEFAULT_CONFIG),
  };
  let runSources: readonly RunFileSource[] = [];
  // Featured runs published with the site (Phase 10), and the one playing (null: none).
  const featuredBase = featuredBaseUrl(document.baseURI);
  let featuredRuns: FeaturedRunsManifest | null = null;
  let featuredRun: string | null = null;
  let runCheckpoints: readonly FoundCheckpoint[] = [];
  // Run browser (Sprint 5.1): the generations of the chosen run, the checkpoint playing, and the
  // tribe filter (null = every tribe).
  let shownCheckpoints: readonly FoundCheckpoint[] = [];
  let playingFound: FoundCheckpoint | null = null;
  let tribeChoice: number | null = null;
  // Replays (Sprint 5.2): the name of the replay file playing (null if none) and export requests.
  let replayName: string | null = null;
  let nextExportRequestId = 1;
  const pendingExports = new Map<number, ExportRequestEntry>();
  let playing: PlayingCheckpoint | null = null;
  let runMessage = '';
  let runMessageIsError = false;

  let rafId: number | null = null;
  let fpsWindowStart = performance.now();
  let fpsFrameCount = 0;
  let currentFps = 0;

  const nextSeq = (): number => ++lastControlSeq;

  const rejectPendingHashes = (reason: string): void => {
    for (const entry of pendingHashRequests.values()) {
      entry.reject(new Error(reason));
    }
    pendingHashRequests.clear();
  };

  const updatePlaybackUi = (): void => {
    playPauseBtn.textContent = desiredRunning ? 'Pause' : 'Play';
    playPauseBtn.setAttribute('aria-pressed', String(desiredRunning));
    for (const btn of speedButtons) {
      const btnSpeed = parseSpeedParam(btn.dataset['speed'] ?? null);
      const active = btnSpeed === desiredSpeed;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.textContent = formatSpeed(btnSpeed);
    }
  };

  const updateHud = (): void => {
    if (latestSnapshot === null) return;
    const summary = climateSummary(latestSnapshot.climate);
    const placing =
      armedEvent === null ? '' : `Click the map to place the ${EVENT_LABELS[armedEvent]}`;
    hudClimateEl.textContent = [summary, placing].filter((t) => t !== '').join(' · ');
    // A replay's events come from its file: spectators can't add any while it plays.
    const replaying = latestSnapshot.replay !== null;
    for (const btn of eventButtons) {
      btn.disabled = replaying;
      const active = btn.dataset['event'] === armedEvent;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    hudTickEl.textContent = `Tick ${latestSnapshot.tick}`;
    hudGenEl.textContent = `Gen ${latestSnapshot.generation}`;
    hudTpsEl.textContent = `${latestSnapshot.actualTicksPerSec.toFixed(1)} t/s`;
    hudPopEl.textContent = `Pop ${latestSnapshot.livingCount}`;

    const pops = latestSnapshot.tribePopulations;
    if (hudTribeNodes.length !== pops.length) {
      hudTribeNodes = pops.map((_, tribeId) => {
        const item = document.createElement('span');
        item.className = 'hud-tribe';
        const swatch = document.createElement('span');
        swatch.className = 'hud-swatch';
        swatch.style.backgroundColor = tribeHex(tribeId);
        const label = document.createElement('span');
        item.append(swatch, label);
        return { item, swatch, label };
      });
      hudTribesEl.replaceChildren(...hudTribeNodes.map((n) => n.item));
    }

    for (let tribeId = 0; tribeId < pops.length; tribeId++) {
      hudTribeNodes[tribeId]!.label.textContent = `${tribeName(tribeId)} ${pops[tribeId]!}`;
    }
    for (const tr of dashRowsEl.querySelectorAll('tr')) {
      const popCell = tr.children[1];
      if (popCell !== undefined)
        popCell.textContent = String(pops[Number(tr.dataset['tribe'])] ?? 0);
    }
  };

  const updateStats = (): void => {
    if (currentMap === null) return;
    const cam = mapView.getCamera();
    const zoomPct = Math.round(cam.zoom * 100);
    mapStatsEl.textContent =
      `${currentMap.preset} ${currentMap.width}×${currentMap.height}` +
      ` · hash ${currentMap.hash}` +
      ` · walkable ${currentMap.walkableCount.toLocaleString()}` +
      ` · chunks ${mapView.getVisibleChunkCount()}/${mapView.getChunkCount()}` +
      ` · zoom ${zoomPct}%`;
  };

  const updateHover = (tile: TileCoord | null): void => {
    if (tile === null || currentMap === null) {
      hoverInfoEl.textContent = 'Drag to pan · Scroll to zoom · Double-click to fit';
      return;
    }
    const idx = tile.y * currentMap.width + tile.x;
    const biomeIdx = currentMap.biomes[idx]!;
    const biomeName = (BIOME_NAMES as Record<number, string>)[biomeIdx] ?? 'Unknown';
    const maxFood = currentMap.maxFood[idx]!;
    const climate =
      latestSnapshot === null ? [] : climateAt(latestSnapshot.climate, tile.x, tile.y);
    hoverInfoEl.textContent =
      `(${tile.x}, ${tile.y}) · ${biomeName} · max food ${maxFood}` +
      (climate.length > 0 ? ` · ${climate.join(', ')} here` : '');
  };

  const mapView = await MapView.create(viewport, {
    onHoverTile: updateHover,
    onClickTile: (tile) => {
      if (armedEvent !== null) {
        sendWorldEvent({ kind: armedEvent, x: tile.x, y: tile.y });
        return;
      }
      inspectAtTile(tile.x, tile.y);
    },
    onViewChange: updateStats,
  });

  const stopRaf = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    currentFps = 0;
    fpsFrameCount = 0;
  };

  const onAnimationFrame = (nowMs: number): void => {
    rafId = null;
    const frame = mapView.renderInterpolatedFrame(nowMs);
    if (frame.rendered) {
      fpsFrameCount++;
    }
    const elapsed = nowMs - fpsWindowStart;
    if (elapsed >= 500) {
      currentFps = (fpsFrameCount * 1000) / elapsed;
      fpsWindowStart = nowMs;
      fpsFrameCount = 0;
    }

    if ((latestSnapshot?.running ?? false) || frame.needsMoreFrames) {
      rafId = requestAnimationFrame(onAnimationFrame);
    } else {
      currentFps = 0;
      fpsFrameCount = 0;
    }
  };

  const ensureRafRunning = (): void => {
    if (rafId === null) {
      fpsWindowStart = performance.now();
      fpsFrameCount = 0;
      rafId = requestAnimationFrame(onAnimationFrame);
    }
  };

  const worker = new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' });

  /** Sends a world event to the worker (Sprint 7.2) and ends placing. */
  const sendWorldEvent = (event: WorldEvent): void => {
    armedEvent = null;
    postToWorker({ type: 'worldEvent', runId: activeRunId, seq: nextSeq(), event });
    updateHud();
  };

  const postToWorker = (msg: MainToWorkerMessage): void => {
    worker.postMessage(msg);
  };

  let resolveInitialReady: (() => void) | null = null;
  let rejectInitialReady: ((err: Error) => void) | null = null;
  const initialReadyPromise = new Promise<void>((resolve, reject) => {
    resolveInitialReady = resolve;
    rejectInitialReady = reject;
  });

  /** Draws one chart: a line per tribe in its colour (Sprint 6.1). */
  const drawChart = (canvas: HTMLCanvasElement, metric: ChartMetric): void => {
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const series = dashboard.series(metric);
    const { paths, max } = chartPaths(
      series,
      canvas.width,
      canvas.height,
      4,
      metric === 'benchmarkScore',
    );
    paths.forEach((runs, i) => {
      ctx.strokeStyle = tribeHex(series[i]!.tribeId);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1.5;
      for (const run of runs) {
        if (run.length === 1) {
          ctx.fillRect(run[0]!.x - 1.5, run[0]!.y - 1.5, 3, 3);
          continue;
        }
        ctx.beginPath();
        run.forEach((p, k) => {
          if (k === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      }
    });
    ctx.fillStyle = '#8fa3ba';
    ctx.font = '10px sans-serif';
    ctx.fillText(max.toFixed(0), 4, 11);
  };

  /** The leaderboard and charts (Sprint 6.1); population is live, the rest per finished generation. */
  const renderDashboard = (): void => {
    const state = dashboard.state();
    dashboardEl.hidden = playing === null && replayName === null;
    dashGenerationEl.textContent =
      state.generation === null
        ? 'No generation finished yet'
        : `Generation ${state.generation} finished`;
    const live = latestSnapshot?.tribePopulations ?? [];
    dashRowsEl.replaceChildren(
      ...state.rows.map((row) => {
        const tr = document.createElement('tr');
        tr.title = `Inspect ${tribeName(row.tribeId)}'s champion`;
        tr.addEventListener('click', () => {
          setInspect({ kind: 'champion', tribeId: row.tribeId });
          treeTribe = row.tribeId;
          requestTree();
        });
        tr.dataset['tribe'] = String(row.tribeId);
        tr.classList.toggle('is-eliminated', !row.alive);
        const name = document.createElement('td');
        const swatch = document.createElement('span');
        swatch.className = 'hud-swatch';
        swatch.style.backgroundColor = tribeHex(row.tribeId);
        swatch.style.display = 'inline-block';
        swatch.style.marginRight = '4px';
        name.append(swatch, tribeName(row.tribeId));
        const cells = [
          String(live[row.tribeId] ?? 0),
          `${row.territoryPct.toFixed(1)}%`,
          String(row.kills),
          row.avgFitness.toFixed(0),
          row.benchmarkScore === null ? '–' : row.benchmarkScore.toFixed(0),
        ].map((text) => {
          const td = document.createElement('td');
          td.textContent = text;
          return td;
        });
        tr.append(name, ...cells);
        return tr;
      }),
    );
    drawChart(chartCanvases.avgFitness, 'avgFitness');
    drawChart(chartCanvases.benchmarkScore, 'benchmarkScore');
    drawChart(chartCanvases.population, 'population');
    dashFeedEl.replaceChildren(
      ...dashboard.feed().map((event) => {
        const li = document.createElement('li');
        const gen = document.createElement('span');
        gen.className = 'feed-gen';
        gen.textContent = `Gen ${event.generation}`;
        li.append(gen, event.text);
        return li;
      }),
    );
  };

  /** Asks the worker for the shown tribe's champion and its ancestors (Sprint 6.3). */
  const requestTree = (): void => {
    const tribeId = treeTribe ?? dashboard.state().rows[0]?.tribeId;
    if (tribeId === undefined) return;
    postToWorker({
      type: 'requestLineage',
      runId: activeRunId,
      requestId: nextLineageRequestId++,
      tribeId,
      depth: 4,
    });
  };

  /** The tree as levels: the champion, its parents, their parents… (shared ancestors once). */
  const treeLevels = (tree: LineageTree): LineageTree[][] => {
    const levels: LineageTree[][] = [[tree]];
    for (;;) {
      const seen = new Set<string>();
      const next = levels[levels.length - 1]!.flatMap((n) => n.parents).filter((n) => {
        const key = `${n.generation}:${n.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (next.length === 0) return levels;
      levels.push(next);
    }
  };

  const renderTree = (tree: LineageTree | null): void => {
    latestTree = tree;
    if (tree === null) {
      dashTreeTitleEl.textContent = 'Family tree';
      dashTreeEl.replaceChildren(document.createTextNode('After the first generation ends'));
      return;
    }
    dashTreeTitleEl.textContent = `Family tree of ${tribeName(tree.tribeId)}'s champion`;
    dashTreeEl.replaceChildren(
      ...treeLevels(tree).map((level, depth) => {
        const row = document.createElement('div');
        row.className = 'tree-level';
        const gen = document.createElement('span');
        gen.className = 'tree-gen';
        gen.textContent = `Gen ${level[0]!.generation}`;
        row.append(
          gen,
          ...level.map((n) => {
            const chip = document.createElement('span');
            chip.className = 'tree-node';
            chip.classList.toggle('is-champion', depth === 0);
            chip.classList.toggle('is-hof', n.fromHallOfFame);
            chip.textContent = `#${n.id}${n.rank === null ? '' : ` · ${n.rank + 1}.`}`;
            chip.title =
              (n.fitness === null ? '' : `fitness ${n.fitness.toFixed(0)}`) +
              (n.fromHallOfFame ? ' · back from the hall of fame' : '') +
              (n.parents.length === 0 && !n.fromHallOfFame ? ' · no recorded parents' : '');
            return chip;
          }),
        );
        return row;
      }),
    );
  };

  /** Asks the worker to inspect a target (null closes the inspector). */
  const setInspect = (target: InspectTarget): void => {
    inspectTarget = target;
    if (target === null) {
      latestInspection = null;
      inspectorEl.hidden = true;
      inspFollow.checked = false;
      mapView.setFollow(null);
    }
    postToWorker({ type: 'inspect', runId: activeRunId, target });
  };

  /** A click on the map: inspect the creature on that tile, or close the inspector. */
  const inspectAtTile = (x: number, y: number): void => {
    const buf = latestSnapshot?.creatures;
    if (buf === undefined) return;
    for (let i = 0; i < buf.count; i++) {
      if (buf.x[i] === x && buf.y[i] === y) {
        setInspect({ kind: 'creature', id: buf.ids[i]! });
        return;
      }
    }
    setInspect(null);
  };

  const fmt = (v: number): string => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

  /** Bar rows: name, a bar as long as |value| (relative to `scale`), the value. */
  const barRows = (
    group: string | null,
    values: readonly { name: string; value: number }[],
    scale: number,
  ): HTMLElement[] => {
    const out: HTMLElement[] = [];
    if (group !== null) {
      const g = document.createElement('span');
      g.className = 'is-group';
      g.textContent = group;
      out.push(g);
    }
    for (const { name, value } of values) {
      const label = document.createElement('span');
      label.textContent = name;
      const track = document.createElement('span');
      const bar = document.createElement('span');
      bar.className = value < 0 ? 'insp-bar is-negative' : 'insp-bar';
      bar.style.display = 'block';
      bar.style.width = `${Math.min(100, (100 * Math.abs(value)) / scale).toFixed(1)}%`;
      track.append(bar);
      const num = document.createElement('span');
      num.textContent = fmt(value);
      num.style.textAlign = 'right';
      out.push(label, track, num);
    }
    return out;
  };

  /** Draws the inspector from the worker's live data (Sprint 6.2). */
  const renderInspector = (inspection: CreatureInspection | null): void => {
    latestInspection = inspection;
    if (inspectTarget === null) return;
    if (inspection === null) {
      inspectorEl.hidden = false;
      inspTitleEl.textContent =
        inspectTarget.kind === 'creature'
          ? "That creature's generation is over"
          : 'Nobody of that tribe is alive';
      inspStatsEl.replaceChildren();
      inspBrainEl.replaceChildren();
      inspInputsEl.replaceChildren();
      return;
    }
    inspectorEl.hidden = false;
    if (inspFollow.checked) mapView.setFollow(inspection.alive ? inspection.id : null);
    inspTitleEl.textContent =
      `${tribeName(inspection.tribeId)} #${inspection.id}` +
      (inspectTarget.kind === 'champion' ? ' · champion' : '') +
      (inspection.alive ? '' : ' · dead');
    const stats: [string, string][] = [
      ['Health', fmt(inspection.health)],
      ['Energy', fmt(inspection.energy)],
      ['Water', fmt(inspection.hydration)],
      ['Age', String(inspection.age)],
      ['Fitness', fmt(inspection.fitness)],
      ['Tile', `${inspection.x}, ${inspection.y}`],
      ['Chose', inspection.intent],
      ['Did', inspection.lastAction],
      ['Kills', String(inspection.kills)],
      ['Helped', String(inspection.alliesHelped)],
    ];
    if (inspection.memory.length > 0)
      stats.push(['Memory', inspection.memory.map(fmt).join(' / ')]);
    if (inspection.call > 0) stats.push(['Calling', fmt(inspection.call)]);
    inspStatsEl.replaceChildren(
      ...stats.flatMap(([k, v]) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        return [dt, dd];
      }),
    );
    if (inspection.hidden === null || inspection.outputs === null) {
      inspBrainEl.replaceChildren(document.createTextNode('No brain (random policy)'));
    } else {
      const outScale = Math.max(1e-9, ...inspection.outputs.map((o) => Math.abs(o.value)));
      inspBrainEl.replaceChildren(
        ...barRows(
          'Hidden',
          inspection.hidden.map((value, i) => ({ name: `h${i + 1}`, value })),
          1,
        ),
        ...barRows('Outputs', inspection.outputs, outScale),
      );
    }
    inspInputsEl.replaceChildren(...barRows(null, inspection.inputs, 1));
  };

  const getState = (): EvolutionIslandDebugState => {
    if (currentMap === null || latestSnapshot === null) {
      throw new Error('Simulation has not finished initializing');
    }
    return {
      simVersion: SIM_VERSION,
      preset: currentMap.preset,
      seed: currentSeed,
      mapHash: currentMap.hash,
      mapWidth: currentMap.width,
      mapHeight: currentMap.height,
      walkableCount: currentMap.walkableCount,
      tribeCount: currentMap.spawnZones.length,
      hotspotCount: currentMap.hotspots.length,
      tick: latestSnapshot.tick,
      generation: latestSnapshot.generation,
      population: latestSnapshot.livingCount,
      tribePopulations: latestSnapshot.tribePopulations,
      running: latestSnapshot.running,
      speed: latestSnapshot.speed,
      actualTicksPerSec: latestSnapshot.actualTicksPerSec,
      worldHash: latestSnapshot.worldHash,
      renderedCreatureCount: mapView.getRenderedCreatureCount(),
      fps: currentFps,
      chunkCount: mapView.getChunkCount(),
      visibleChunkCount: mapView.getVisibleChunkCount(),
      renderCount,
      rendererType: mapView.getRendererType(),
      overlaysVisible: mapView.getOverlaysVisible(),
      camera: mapView.getCamera(),
      mode: replayName !== null ? 'replay' : playing === null ? 'random' : 'checkpoint',
      replay: latestSnapshot.replay,
      checkpoint: playing,
      checkpointOptions: shownCheckpoints.map((c) => c.label),
      runMessage,
      runMessageIsError,
      dashboard: dashboard.state(),
      inspection: latestInspection,
      climate: latestSnapshot.climate,
      armedEvent,
      featuredRuns: featuredRuns?.runs.map((r) => r.name) ?? [],
      featuredRun,
      feed: dashboard.feed(),
      familyTree:
        latestTree === null
          ? null
          : treeLevels(latestTree).map((level) =>
              level.map((n) => ({ generation: n.generation, id: n.id, rank: n.rank })),
            ),
      following: mapView.getFollow(),
    };
  };

  const debugHook: EvolutionIslandDebugHook = {
    get simVersion() {
      return SIM_VERSION;
    },
    get preset() {
      return getState().preset;
    },
    get seed() {
      return getState().seed;
    },
    get mapHash() {
      return getState().mapHash;
    },
    get mapWidth() {
      return getState().mapWidth;
    },
    get mapHeight() {
      return getState().mapHeight;
    },
    get walkableCount() {
      return getState().walkableCount;
    },
    get tribeCount() {
      return getState().tribeCount;
    },
    get hotspotCount() {
      return getState().hotspotCount;
    },
    get tick() {
      return getState().tick;
    },
    get generation() {
      return getState().generation;
    },
    get population() {
      return getState().population;
    },
    get tribePopulations() {
      return getState().tribePopulations;
    },
    get running() {
      return getState().running;
    },
    get speed() {
      return getState().speed;
    },
    get actualTicksPerSec() {
      return getState().actualTicksPerSec;
    },
    get worldHash() {
      return getState().worldHash;
    },
    get renderedCreatureCount() {
      return getState().renderedCreatureCount;
    },
    get fps() {
      return getState().fps;
    },
    get chunkCount() {
      return getState().chunkCount;
    },
    get visibleChunkCount() {
      return getState().visibleChunkCount;
    },
    get renderCount() {
      return getState().renderCount;
    },
    get rendererType() {
      return getState().rendererType;
    },
    get overlaysVisible() {
      return getState().overlaysVisible;
    },
    get camera() {
      return getState().camera;
    },
    get mode() {
      return getState().mode;
    },
    get checkpoint() {
      return getState().checkpoint;
    },
    get replay() {
      return getState().replay;
    },
    get dashboard() {
      return getState().dashboard;
    },
    exportReplay() {
      return requestReplayExport();
    },
    get inspection() {
      return getState().inspection;
    },
    get following() {
      return getState().following;
    },
    get climate() {
      return getState().climate;
    },
    get featuredRuns() {
      return getState().featuredRuns;
    },
    get featuredRun() {
      return getState().featuredRun;
    },
    get armedEvent() {
      return getState().armedEvent;
    },
    get feed() {
      return getState().feed;
    },
    get familyTree() {
      return getState().familyTree;
    },
    inspect(target: InspectTarget) {
      setInspect(target);
    },
    creatureTiles() {
      const buf = latestSnapshot?.creatures;
      if (buf === undefined) return [];
      return Array.from({ length: buf.count }, (_, i) => ({
        id: buf.ids[i]!,
        x: buf.x[i]!,
        y: buf.y[i]!,
      }));
    },
    get checkpointOptions() {
      return getState().checkpointOptions;
    },
    get runMessage() {
      return getState().runMessage;
    },
    get runMessageIsError() {
      return getState().runMessageIsError;
    },
    getState,
    pauseAtTick(targetTick: number | null) {
      postToWorker({
        type: 'setPauseAtTick',
        runId: activeRunId,
        seq: nextSeq(),
        targetTick,
      });
    },
    requestHash() {
      const requestId = nextHashRequestId++;
      return new Promise((resolve, reject) => {
        pendingHashRequests.set(requestId, { resolve, reject });
        postToWorker({ type: 'requestHash', runId: activeRunId, requestId });
      });
    },
  };

  worker.addEventListener('message', (event: MessageEvent<WorkerToMainMessage>) => {
    const msg = event.data;

    if (msg.type === 'ready') {
      if (msg.runId !== activeRunId) return;
      currentMap = msg.map;
      currentSeed = msg.seed;
      latestSnapshot = msg.snapshot;
      if (msg.snapshot.ackSeq >= lastControlSeq) {
        desiredRunning = msg.snapshot.running;
        desiredSpeed = msg.snapshot.speed;
      }

      mapView.setMap(msg.map);
      mapView.setOverlaysVisible(overlaysToggle.checked);
      mapView.setClimate(msg.snapshot.climate);
      mapView.setCreatureSnapshot(
        msg.snapshot.creatures,
        performance.now(),
        msg.snapshot.tickDurationMs,
        msg.snapshot.running,
        true,
      );
      renderCount++;
      updateStats();
      updateHover(null);
      updateHud();
      updatePlaybackUi();
      if (msg.snapshot.running) {
        ensureRafRunning();
      } else {
        stopRaf();
      }
      window.__ei = debugHook;
      resolveInitialReady?.();
      resolveInitialReady = null;
      rejectInitialReady = null;
      return;
    }

    if (msg.type === 'snapshot') {
      if (msg.snapshot.runId !== activeRunId) return;
      latestSnapshot = msg.snapshot;
      if (msg.snapshot.replay !== null) showReplayStatus(msg.snapshot.replay);
      renderInspector(msg.snapshot.inspection);
      mapView.setClimate(msg.snapshot.climate);
      if (msg.snapshot.ackSeq >= lastControlSeq) {
        desiredRunning = msg.snapshot.running;
        desiredSpeed = msg.snapshot.speed;
      }
      // Coalesce running-frame renders in RAF; render synchronously on pause/step for instant feedback.
      mapView.setCreatureSnapshot(
        msg.snapshot.creatures,
        performance.now(),
        msg.snapshot.tickDurationMs,
        msg.snapshot.running,
        !msg.snapshot.running,
      );
      updateHud();
      updatePlaybackUi();
      if (msg.snapshot.running) {
        ensureRafRunning();
      }
      return;
    }

    if (msg.type === 'generationStats') {
      if (msg.runId !== activeRunId) return;
      dashboard.add(msg.reports);
      renderDashboard();
      requestTree();
      return;
    }

    if (msg.type === 'lineage') {
      if (msg.runId !== activeRunId) return;
      renderTree(msg.tree);
      return;
    }

    if (msg.type === 'replayExport') {
      const entry = pendingExports.get(msg.requestId);
      if (entry === undefined) return;
      pendingExports.delete(msg.requestId);
      if (msg.text === null) entry.reject(new Error(msg.error ?? 'Nothing to export'));
      else entry.resolve(msg.text);
      return;
    }

    if (msg.type === 'hash') {
      if (msg.runId !== activeRunId) return;
      const entry = pendingHashRequests.get(msg.requestId);
      if (entry !== undefined) {
        pendingHashRequests.delete(msg.requestId);
        entry.resolve({ tick: msg.tick, worldHash: msg.worldHash });
      }
      return;
    }

    if (msg.runId === activeRunId) {
      stopRaf();
      rejectPendingHashes(msg.message);
      rejectInitialReady?.(new Error(msg.message));
      resolveInitialReady = null;
      rejectInitialReady = null;
      showFatalError(msg.message);
    }
  });

  worker.addEventListener('error', (event) => {
    const errMsg = event.message || 'Simulation worker crashed';
    stopRaf();
    rejectPendingHashes(errMsg);
    rejectInitialReady?.(new Error(errMsg));
    resolveInitialReady = null;
    rejectInitialReady = null;
    showFatalError(errMsg);
  });

  const startWorld = (
    preset: MapPresetId,
    seed: Seed,
    start?: EvolutionStart,
    replayText?: string,
  ): void => {
    exportReplayBtn.hidden = start === undefined && replayText === undefined;
    dashboard.reset();
    treeTribe = null;
    renderTree(null);
    inspectTarget = null;
    latestInspection = null;
    inspectorEl.hidden = true;
    inspFollow.checked = false;
    mapView.setFollow(null);
    dashboardEl.hidden = start === undefined && replayText === undefined;
    if (replayText === undefined) replayName = null;
    seedInput.value = String(seed);
    presetSelect.value = preset;
    syncUrlParams(
      preset,
      seed,
      featuredRun,
      start === undefined ? null : (playing?.generation ?? null),
    );

    activeRunId++;
    armedEvent = null; // a placement never carries over to another world
    rejectPendingHashes('Simulation restarted');
    postToWorker({
      type: 'init',
      runId: activeRunId,
      seq: nextSeq(),
      preset,
      seed,
      speed: desiredSpeed,
      running: desiredRunning,
      pauseAtTick: null,
      ...(start === undefined ? {} : { start }),
      ...(replayText === undefined ? {} : { replay: replayText }),
    });
  };

  /** Plays a replay file (Sprint 5.2): checked against its hashes, stopping at its end. */
  const playReplayText = (name: string, text: string): void => {
    let file;
    try {
      file = parseReplay(text);
    } catch (error: unknown) {
      setRunMessage(`Can't play ${name}: ${errorMessage(error)}`, true);
      return;
    }
    playing = null;
    playingFound = null;
    featuredRun = null;
    featuredSelect.value = '';
    replayName = name;
    checkpointSelect.selectedIndex = -1;
    setRunMessage(`Replay ${name}: tick 0 / ${file.ticks}`, false);
    startWorld(file.preset, file.seed, undefined, text);
  };

  /** The run message while a replay plays: progress, or the first divergence. */
  const showReplayStatus = (status: ReplayStatus): void => {
    if (replayName === null) return;
    if (status.mismatch !== null) {
      const m = status.mismatch;
      setRunMessage(
        `Replay ${replayName} DIVERGED at tick ${m.tick}: expected ${m.expected}, got ${m.actual}`,
        true,
      );
      return;
    }
    const done = status.played >= status.ticks ? ' · finished, every hash matched' : '';
    setRunMessage(
      `Replay ${replayName}: tick ${status.played} / ${status.ticks} · hashes ok ` +
        `${status.matched} / ${status.total}${done}`,
      false,
    );
  };

  const requestReplayExport = (): Promise<string> => {
    const requestId = nextExportRequestId++;
    return new Promise((resolve, reject) => {
      pendingExports.set(requestId, { resolve, reject });
      postToWorker({ type: 'exportReplay', runId: activeRunId, requestId });
    });
  };

  const setRunMessage = (text: string, isError: boolean): void => {
    runMessage = text;
    runMessageIsError = isError;
    runInfoEl.textContent = text;
    runInfoEl.classList.toggle('is-error', isError);
  };

  /** Random-policy world on a generated map (the default mode). */
  const generateAndRun = (preset: MapPresetId, rawSeed: string | Seed): void => {
    const seed = typeof rawSeed === 'number' ? rawSeed : parseSeed(rawSeed, 42);
    featuredRun = null;
    featuredSelect.value = '';
    if (playing !== null) {
      playing = null;
      playingFound = null;
      checkpointSelect.selectedIndex = -1;
      setRunMessage('', false);
    }
    startWorld(preset, seed);
  };

  /** Plays a saved checkpoint: its map (preset + seed) and its tribes' hall-of-fame genomes. */
  const playCheckpoint = async (found: FoundCheckpoint): Promise<void> => {
    let start: EvolutionStart;
    try {
      start = onlyTribe(await loadCheckpoint(found, runSources, expectedCheckpoint), tribeChoice);
    } catch (error: unknown) {
      setRunMessage(`Can't play ${found.label}: ${errorMessage(error)}`, true);
      return;
    }
    const { preset, seed, generation } = found.checkpoint;
    playing = {
      label: found.label,
      generation,
      preset,
      seed,
      tribeSizes: start.tribes.map((t) => t.genomes.length),
    };
    checkpointSelect.selectedIndex = shownCheckpoints.indexOf(found);
    playingFound = found;
    setRunMessage(
      `Watching ${found.label} champions${tribeChoice === null ? '' : ` · ${tribeName(tribeChoice)} only`}`,
      false,
    );
    startWorld(preset, seed, start);
  };

  /**
   * New files picked or dropped, or a featured run (`featured`: its name, Phase 10): list their
   * checkpoints and play the latest.
   */
  const loadRunSources = async (
    sources: readonly RunFileSource[],
    featured: string | null = null,
    generation: number | null = null,
  ): Promise<void> => {
    const scan = await scanRunFiles(sources);
    const latest = defaultCheckpoint(scan);
    // A link's generation (Phase 10), if the run has it; else the latest.
    const first =
      (latest === null
        ? undefined
        : scan.checkpoints.find(
            (c) =>
              runName(c.checkpoint) === runName(latest.checkpoint) &&
              c.checkpoint.generation === generation,
          )) ?? latest;
    if (first === null) {
      const why = scan.problems[0] ?? 'no checkpoint.json among the files (pick a run folder)';
      setRunMessage(`No saved generation found: ${why}`, true);
      return;
    }
    runSources = sources;
    runCheckpoints = scan.checkpoints;
    featuredRun = featured;
    featuredSelect.value = featured ?? '';
    runSelect.replaceChildren(
      ...runNames(runCheckpoints).map((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        return option;
      }),
    );
    runField.hidden = false;
    showRun(runName(first.checkpoint));
    await playCheckpoint(first);
  };

  /** Run browser: lists a run's saved generations and its tribes (Sprint 5.1). */
  const showRun = (name: string): void => {
    runSelect.value = name;
    shownCheckpoints = checkpointsOfRun(runCheckpoints, name);
    checkpointSelect.replaceChildren(
      ...shownCheckpoints.map((c, i) => {
        const option = document.createElement('option');
        option.value = String(i);
        option.textContent = c.label;
        return option;
      }),
    );
    // Nothing selected until a checkpoint actually plays (playCheckpoint selects it); otherwise a
    // refused first option would look selected, and picking it again would fire no 'change'.
    checkpointSelect.selectedIndex = -1;
    checkpointField.hidden = false;
    tribeChoice = null;
    const tribes = shownCheckpoints[shownCheckpoints.length - 1]?.checkpoint.tribes ?? [];
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = 'All tribes';
    tribeSelect.replaceChildren(
      all,
      ...tribes.map((t) => {
        const option = document.createElement('option');
        option.value = String(t.tribeId);
        option.textContent = tribeName(t.tribeId);
        return option;
      }),
    );
    tribeSelect.value = 'all';
    tribeField.hidden = false;
  };

  const loadRunSafely = (
    sources: Promise<readonly RunFileSource[]>,
    featured: string | null = null,
    generation: number | null = null,
  ): void => {
    sources
      .then((list) => loadRunSources(list, featured, generation))
      .catch((error: unknown) => {
        setRunMessage(`Could not read the run: ${errorMessage(error)}`, true);
      });
  };

  const togglePlayPause = (): void => {
    const nextRunning = !desiredRunning;
    desiredRunning = nextRunning;
    updatePlaybackUi();
    postToWorker({
      type: 'setRunning',
      runId: activeRunId,
      seq: nextSeq(),
      running: nextRunning,
    });
  };

  const blurMouseTarget = (event: MouseEvent): void => {
    if (event.detail > 0 && event.currentTarget instanceof HTMLElement) {
      event.currentTarget.blur();
    }
  };

  playPauseBtn.addEventListener('click', (event) => {
    blurMouseTarget(event);
    togglePlayPause();
  });

  stepBtn.addEventListener('click', (event) => {
    blurMouseTarget(event);
    desiredRunning = false;
    updatePlaybackUi();
    postToWorker({ type: 'step', runId: activeRunId, seq: nextSeq(), ticks: 1 });
  });

  for (const btn of speedButtons) {
    btn.addEventListener('click', (event) => {
      blurMouseTarget(event);
      const nextSpeed = parseSpeedParam(btn.dataset['speed'] ?? null);
      desiredSpeed = nextSpeed;
      updatePlaybackUi();
      postToWorker({
        type: 'setSpeed',
        runId: activeRunId,
        seq: nextSeq(),
        speed: nextSpeed,
      });
    });
  }

  for (const btn of eventButtons) {
    btn.addEventListener('click', (event) => {
      blurMouseTarget(event);
      const kind = btn.dataset['event'];
      if (kind === 'winter') {
        sendWorldEvent({ kind, x: 0, y: 0 });
      } else if (kind === 'drought' || kind === 'flood' || kind === 'foodZone') {
        armedEvent = armedEvent === kind ? null : kind;
        updateHud();
      }
    });
  }

  viewport.addEventListener('pointerdown', () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      active.blur();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && armedEvent !== null) {
      armedEvent = null;
      updateHud();
      return;
    }
    if (event.code !== 'Space' || event.repeat) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLSelectElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLButtonElement
    ) {
      return;
    }
    event.preventDefault();
    togglePlayPause();
  });

  presetSelect.addEventListener('change', () => {
    presetSelect.blur();
    const val = presetSelect.value;
    if (isMapPresetId(val)) {
      generateAndRun(val, seedInput.value);
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const val = presetSelect.value;
    if (isMapPresetId(val)) {
      generateAndRun(val, seedInput.value);
    }
  });

  randomBtn.addEventListener('click', (event) => {
    blurMouseTarget(event);
    const nextSeed = Math.floor(Math.random() * 1_000_000);
    const val = presetSelect.value;
    if (isMapPresetId(val)) {
      generateAndRun(val, nextSeed);
    }
  });

  inspFollow.addEventListener('change', () => {
    mapView.setFollow(
      inspFollow.checked && latestInspection?.alive === true ? latestInspection.id : null,
    );
  });

  inspClose.addEventListener('click', (event) => {
    blurMouseTarget(event);
    setInspect(null);
  });

  loadReplayBtn.addEventListener('click', (event) => {
    blurMouseTarget(event);
    replayInput.click();
  });

  replayInput.addEventListener('change', () => {
    const file = replayInput.files?.[0];
    replayInput.value = '';
    if (file === undefined) return;
    file
      .text()
      .then((text) => {
        playReplayText(file.name, text);
      })
      .catch((error: unknown) => {
        setRunMessage(`Could not read ${file.name}: ${errorMessage(error)}`, true);
      });
  });

  exportReplayBtn.addEventListener('click', (event) => {
    blurMouseTarget(event);
    requestReplayExport()
      .then((text) => {
        const name = `${presetSelect.value}-${seedInput.value}-gen${latestSnapshot?.generation ?? 0}.replay.json`;
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        URL.revokeObjectURL(url);
        setRunMessage(`Saved ${name}`, false);
      })
      .catch((error: unknown) => {
        setRunMessage(`Can't export a replay: ${errorMessage(error)}`, true);
      });
  });

  loadRunBtn.addEventListener('click', (event) => {
    blurMouseTarget(event);
    runInput.click();
  });

  runInput.addEventListener('change', () => {
    const files = runInput.files === null ? [] : Array.from(runInput.files);
    runInput.value = ''; // picking the same folder again still fires 'change'
    loadRunSafely(Promise.resolve(sourcesFromFileList(files)));
  });

  checkpointSelect.addEventListener('change', () => {
    checkpointSelect.blur();
    const found = shownCheckpoints[Number(checkpointSelect.value)];
    if (found !== undefined) void playCheckpoint(found);
  });

  runSelect.addEventListener('change', () => {
    runSelect.blur();
    showRun(runSelect.value);
    const latest = shownCheckpoints[shownCheckpoints.length - 1];
    if (latest !== undefined) void playCheckpoint(latest);
  });

  tribeSelect.addEventListener('change', () => {
    tribeSelect.blur();
    tribeChoice = tribeSelect.value === 'all' ? null : Number(tribeSelect.value);
    if (playingFound !== null) void playCheckpoint(playingFound);
  });

  const isFileDrag = (event: DragEvent): boolean =>
    event.dataTransfer !== null && Array.from(event.dataTransfer.types).includes('Files');

  window.addEventListener('dragover', (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dropOverlay.hidden = false;
  });

  window.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) dropOverlay.hidden = true;
  });

  window.addEventListener('drop', (event) => {
    dropOverlay.hidden = true;
    if (event.dataTransfer === null) return;
    event.preventDefault();
    const dropped = sourcesFromDrop(event.dataTransfer);
    dropped
      .then(async (sources) => {
        const replay = sources.find((s) => s.path.endsWith('.replay.json'));
        if (replay !== undefined && sources.length === 1) {
          playReplayText(replay.path, await replay.text());
          return;
        }
        loadRunSafely(Promise.resolve(sources));
      })
      .catch((error: unknown) => {
        setRunMessage(`Could not read the dropped files: ${errorMessage(error)}`, true);
      });
  });

  overlaysToggle.addEventListener('change', () => {
    mapView.setOverlaysVisible(overlaysToggle.checked);
  });

  resetViewBtn.addEventListener('click', (event) => {
    blurMouseTarget(event);
    mapView.resetView();
  });

  window.addEventListener('beforeunload', () => {
    stopRaf();
    rejectPendingHashes('Viewer unloaded');
    worker.terminate();
    mapView.destroy();
  });

  /** Plays a featured run by name (menu or `?run=` link); false if the site has no such run. */
  const playFeatured = (name: string, generation: number | null = null): boolean => {
    const run = featuredRuns?.runs.find((r) => r.name === name);
    if (run === undefined) return false;
    loadRunSafely(
      Promise.resolve(featuredSources(run, featuredBase, fetchTextOrThrow)),
      name,
      generation,
    );
    return true;
  };

  featuredSelect.addEventListener('change', () => {
    featuredSelect.blur();
    if (featuredSelect.value !== '') playFeatured(featuredSelect.value);
  });

  copyLinkBtn.addEventListener('click', (event) => {
    blurMouseTarget(event);
    const link = window.location.href;
    navigator.clipboard
      .writeText(link)
      .then(() => {
        setRunMessage(`Link copied: ${link}`, false);
      })
      .catch(() => {
        setRunMessage(`Copy this link: ${link}`, false);
      });
  });

  updatePlaybackUi();
  generateAndRun(initial.preset, initial.seed);
  const notice = versionNotice(initial.linkVersion);
  if (notice !== null) setRunMessage(notice, true);
  await initialReadyPromise;

  // Featured runs (Phase 10): listed if the site has them and this build can play them. The menu
  // is there from the start (disabled while loading), so the toolbar never shifts the map.
  const manifest = await fetchFeaturedRuns(featuredBase, fetchTextOrThrow);
  const placeholder = featuredSelect.options[0]!;
  if (manifest !== null && featuredRunsPlayable(manifest, expectedCheckpoint)) {
    featuredRuns = manifest;
    placeholder.textContent = 'Watch a trained run…';
    featuredSelect.disabled = false;
    featuredSelect.append(
      ...manifest.runs.map((run) => {
        const option = document.createElement('option');
        option.value = run.name;
        option.textContent = run.title;
        return option;
      }),
    );
  } else {
    placeholder.textContent =
      manifest === null ? 'No trained runs here' : 'Trained runs are outdated';
  }
  if (initial.run !== null && !playFeatured(initial.run, initial.generation)) {
    setRunMessage(`This site has no trained run "${initial.run}"`, true);
  }
}

boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Evolution Island viewer failed to initialize:', error);
  showFatalError(message);
});
