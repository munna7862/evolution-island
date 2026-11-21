import { parseSeed } from '@evolution-island/shared';
import {
  generateMap,
  MAP_PRESETS,
  SIM_VERSION,
  type MapPresetId,
  type Seed,
  type WorldMap,
} from '@evolution-island/sim-core';
import type { EvolutionIslandDebugHook, EvolutionIslandDebugState } from './debug-hook.js';
import type { TileCoord } from './renderer/camera.js';
import { MapView } from './renderer/map-view.js';
import { BIOME_LEGEND, BIOME_NAMES } from './renderer/palette.js';
import { statusLine } from './status.js';
import './styles.css';

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

function readInitialParams(): { readonly preset: MapPresetId; readonly seed: Seed } {
  const params = new URLSearchParams(window.location.search);
  const rawPreset = params.get('preset');
  const rawSeed = params.get('seed');
  return {
    preset: isMapPresetId(rawPreset) ? rawPreset : 'medium',
    seed: rawSeed !== null ? parseSeed(rawSeed, 42) : 42,
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
  const viewport = requireEl('#viewport', HTMLElement);
  const mapStatsEl = requireEl('#map-stats', HTMLElement);
  const hoverInfoEl = requireEl('#hover-info', HTMLElement);
  const legendEl = requireEl('#legend', HTMLElement);

  statusBadge.textContent = statusLine();
  renderLegend(legendEl);

  const initial = readInitialParams();
  presetSelect.value = initial.preset;
  seedInput.value = String(initial.seed);

  let currentMap: WorldMap | null = null;
  let currentSeed: Seed = initial.seed;
  let renderCount = 0;

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

  const generateAndRender = (preset: MapPresetId, rawSeed: string | Seed): void => {
    const seed = typeof rawSeed === 'number' ? rawSeed : parseSeed(rawSeed, 42);
    currentSeed = seed;
    seedInput.value = String(seed);
    presetSelect.value = preset;

    currentMap = generateMap({ preset, seed });
    mapView.setMap(currentMap);
    mapView.setOverlaysVisible(overlaysToggle.checked);
    renderCount++;
    syncUrlParams(preset, seed);
    updateStats();
    updateHover(null);
  };

  const getState = (): EvolutionIslandDebugState => {
    if (currentMap === null) {
      throw new Error('Map has not been generated yet');
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
      tick: 0,
      population: 0,
      chunkCount: mapView.getChunkCount(),
      visibleChunkCount: mapView.getVisibleChunkCount(),
      renderCount,
      rendererType: mapView.getRendererType(),
      overlaysVisible: mapView.getOverlaysVisible(),
      camera: mapView.getCamera(),
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
      return 0;
    },
    get population() {
      return 0;
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
    getState,
  };

  presetSelect.addEventListener('change', () => {
    const val = presetSelect.value;
    if (isMapPresetId(val)) {
      generateAndRender(val, seedInput.value);
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const val = presetSelect.value;
    if (isMapPresetId(val)) {
      generateAndRender(val, seedInput.value);
    }
  });

  randomBtn.addEventListener('click', () => {
    const nextSeed = Math.floor(Math.random() * 1_000_000);
    const val = presetSelect.value;
    if (isMapPresetId(val)) {
      generateAndRender(val, nextSeed);
    }
  });

  overlaysToggle.addEventListener('change', () => {
    mapView.setOverlaysVisible(overlaysToggle.checked);
  });

  resetViewBtn.addEventListener('click', () => {
    mapView.resetView();
  });

  generateAndRender(initial.preset, initial.seed);
  window.__ei = debugHook;
}

boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Evolution Island viewer failed to initialize:', error);
  showFatalError(message);
});
