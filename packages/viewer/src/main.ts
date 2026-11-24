import {
  formatSpeed,
  parseSeed,
  SIM_SPEEDS,
  type MainToWorkerMessage,
  type SimSnapshot,
  type SimSpeed,
  type TransferableMapData,
  type WorkerToMainMessage,
} from '@evolution-island/shared';
import {
  brainSpecFromConfig,
  DEFAULT_CONFIG,
  hashConfig,
  MAP_PRESETS,
  SIM_VERSION,
  type EvolutionStart,
  type MapPresetId,
  type Seed,
} from '@evolution-island/sim-core';
import type {
  EvolutionIslandDebugHook,
  EvolutionIslandDebugState,
  PlayingCheckpoint,
} from './debug-hook.js';
import type { TileCoord } from './renderer/camera.js';
import { MapView } from './renderer/map-view.js';
import { BIOME_LEGEND, BIOME_NAMES, tribeHex, tribeName } from './renderer/palette.js';
import { sourcesFromDrop, sourcesFromFileList } from './run-drop.js';
import {
  defaultCheckpoint,
  loadCheckpoint,
  scanRunFiles,
  type FoundCheckpoint,
  type RunFileSource,
} from './run-loader.js';
import { statusLine } from './status.js';
import './styles.css';

interface HashRequestEntry {
  readonly resolve: (result: { readonly tick: number; readonly worldHash: string }) => void;
  readonly reject: (reason: Error) => void;
}

interface InitialParams {
  readonly preset: MapPresetId;
  readonly seed: Seed;
  readonly running: boolean;
  readonly speed: SimSpeed;
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
  const rawPreset = params.get('preset');
  const rawSeed = params.get('seed');
  const paused = params.get('paused');
  return {
    preset: isMapPresetId(rawPreset) ? rawPreset : 'medium',
    seed: rawSeed !== null ? parseSeed(rawSeed, 42) : 42,
    running: paused !== '1' && paused !== 'true',
    speed: parseSpeedParam(params.get('speed')),
  };
}

function syncUrlParams(preset: MapPresetId, seed: Seed): void {
  const url = new URL(window.location.href);
  url.searchParams.set('preset', preset);
  url.searchParams.set('seed', String(seed));
  window.history.replaceState(null, '', url);
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
  const viewport = requireEl('#viewport', HTMLElement);
  const mapStatsEl = requireEl('#map-stats', HTMLElement);
  const hoverInfoEl = requireEl('#hover-info', HTMLElement);
  const legendEl = requireEl('#legend', HTMLElement);
  const hudTickEl = requireEl('#hud-tick', HTMLElement);
  const hudGenEl = requireEl('#hud-generation', HTMLElement);
  const hudTpsEl = requireEl('#hud-tps', HTMLElement);
  const hudPopEl = requireEl('#hud-population', HTMLElement);
  const hudTribesEl = requireEl('#hud-tribes', HTMLElement);
  const loadRunBtn = requireEl('#load-run-btn', HTMLButtonElement);
  const runInput = requireEl('#run-input', HTMLInputElement);
  const checkpointField = requireEl('#checkpoint-field', HTMLElement);
  const checkpointSelect = requireEl('#checkpoint-select', HTMLSelectElement);
  const runInfoEl = requireEl('#run-info', HTMLElement);
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
  let runCheckpoints: readonly FoundCheckpoint[] = [];
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
    hoverInfoEl.textContent = `(${tile.x}, ${tile.y}) · ${biomeName} · max food ${maxFood}`;
  };

  const mapView = await MapView.create(viewport, {
    onHoverTile: updateHover,
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

  const postToWorker = (msg: MainToWorkerMessage): void => {
    worker.postMessage(msg);
  };

  let resolveInitialReady: (() => void) | null = null;
  let rejectInitialReady: ((err: Error) => void) | null = null;
  const initialReadyPromise = new Promise<void>((resolve, reject) => {
    resolveInitialReady = resolve;
    rejectInitialReady = reject;
  });

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
      mode: playing === null ? 'random' : 'checkpoint',
      checkpoint: playing,
      checkpointOptions: runCheckpoints.map((c) => c.label),
      runMessage,
      runMessageIsError,
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

  const startWorld = (preset: MapPresetId, seed: Seed, start?: EvolutionStart): void => {
    seedInput.value = String(seed);
    presetSelect.value = preset;
    syncUrlParams(preset, seed);

    activeRunId++;
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
    if (playing !== null) {
      playing = null;
      checkpointSelect.selectedIndex = -1;
      setRunMessage('', false);
    }
    startWorld(preset, seed);
  };

  /** Plays a saved checkpoint: its map (preset + seed) and its tribes' hall-of-fame genomes. */
  const playCheckpoint = async (found: FoundCheckpoint): Promise<void> => {
    let start: EvolutionStart;
    try {
      start = await loadCheckpoint(found, runSources, expectedCheckpoint);
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
    checkpointSelect.selectedIndex = runCheckpoints.indexOf(found);
    setRunMessage(`Watching ${found.label} champions`, false);
    startWorld(preset, seed, start);
  };

  /** New files picked or dropped: list their checkpoints and play the latest. */
  const loadRunSources = async (sources: readonly RunFileSource[]): Promise<void> => {
    const scan = await scanRunFiles(sources);
    const first = defaultCheckpoint(scan);
    if (first === null) {
      const why = scan.problems[0] ?? 'no checkpoint.json among the files (pick a run folder)';
      setRunMessage(`No saved generation found: ${why}`, true);
      return;
    }
    runSources = sources;
    runCheckpoints = scan.checkpoints;
    checkpointSelect.replaceChildren(
      ...runCheckpoints.map((c, i) => {
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
    await playCheckpoint(first);
  };

  const loadRunSafely = (sources: Promise<readonly RunFileSource[]>): void => {
    sources
      .then((list) => loadRunSources(list))
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

  viewport.addEventListener('pointerdown', () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      active.blur();
    }
  });

  window.addEventListener('keydown', (event) => {
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
    const found = runCheckpoints[Number(checkpointSelect.value)];
    if (found !== undefined) void playCheckpoint(found);
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
    loadRunSafely(sourcesFromDrop(event.dataTransfer));
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

  updatePlaybackUi();
  generateAndRun(initial.preset, initial.seed);
  await initialReadyPromise;
}

boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Evolution Island viewer failed to initialize:', error);
  showFatalError(message);
});
