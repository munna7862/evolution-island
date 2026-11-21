import { DEFAULT_CONFIG, type SimConfig, type WorldMap } from '@evolution-island/sim-core';
import {
  Application,
  BufferImageSource,
  Container,
  Graphics,
  RendererType,
  Sprite,
  Texture,
} from 'pixi.js';
import {
  fitMapToViewport,
  panCamera,
  screenToTile,
  TILE_WORLD_SIZE,
  zoomCameraAt,
  type CameraState,
  type TileCoord,
} from './camera.js';
import {
  buildChunkPixels,
  computeChunkGrid,
  computeVisibleChunkIndices,
  type ChunkDescriptor,
} from './chunks.js';
import { tribeColor } from './palette.js';

export interface MapViewCallbacks {
  readonly onHoverTile?: (tile: TileCoord | null) => void;
  readonly onViewChange?: () => void;
}

interface ChunkEntry {
  readonly descriptor: ChunkDescriptor;
  readonly sprite: Sprite;
}

const RENDERER_WEBGL: number = RendererType.WEBGL;
const RENDERER_WEBGPU: number = RendererType.WEBGPU;
const RENDERER_CANVAS: number = RendererType.CANVAS;

function formatRendererType(type: number): string {
  if (type === RENDERER_WEBGL) return 'webgl';
  if (type === RENDERER_WEBGPU) return 'webgpu';
  if (type === RENDERER_CANVAS) return 'canvas';
  return 'unknown';
}

function normalizeWheelDelta(event: WheelEvent): number {
  let dy = event.deltaY;
  if (event.deltaMode === 1) {
    dy *= 32; // DOM_DELTA_LINE
  } else if (event.deltaMode === 2) {
    dy *= 240; // DOM_DELTA_PAGE
  }
  return Math.max(-240, Math.min(240, dy));
}

export class MapView {
  private readonly app: Application;
  private readonly hostEl: HTMLElement;
  private readonly callbacks: MapViewCallbacks;
  private readonly worldContainer = new Container();
  private readonly terrainContainer = new Container();
  private readonly overlayGraphics = new Graphics();
  private readonly resizeObserver: ResizeObserver;

  private map: WorldMap | null = null;
  private chunks: readonly ChunkEntry[] = [];
  private chunkDescriptors: readonly ChunkDescriptor[] = [];
  private visibleChunkCount = 0;
  private camera: CameraState = { x: 0, y: 0, zoom: 1, minZoom: 1e-4, maxZoom: 16 };
  private draggingPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private constructor(app: Application, hostEl: HTMLElement, callbacks: MapViewCallbacks) {
    this.app = app;
    this.hostEl = hostEl;
    this.callbacks = callbacks;

    this.worldContainer.addChild(this.terrainContainer, this.overlayGraphics);
    this.app.stage.addChild(this.worldContainer);

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = this.hostEl;
      if (clientWidth <= 0 || clientHeight <= 0) return;
      this.app.renderer.resize(clientWidth, clientHeight);
      if (this.map !== null) {
        this.applyCamera();
        this.callbacks.onViewChange?.();
      }
    });
    this.resizeObserver.observe(this.hostEl);
  }

  static async create(hostEl: HTMLElement, callbacks: MapViewCallbacks = {}): Promise<MapView> {
    const app = new Application();
    await app.init({
      autoStart: false,
      preference: 'webgl',
      failIfMajorPerformanceCaveat: false,
      width: Math.max(1, hostEl.clientWidth),
      height: Math.max(1, hostEl.clientHeight),
      background: 0x0b1724,
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });

    hostEl.replaceChildren(app.canvas);
    return new MapView(app, hostEl, callbacks);
  }

  setMap(map: WorldMap, config: SimConfig = DEFAULT_CONFIG): void {
    this.destroyChunks();
    this.map = map;

    const descriptors = computeChunkGrid(map.width, map.height);
    const entries: ChunkEntry[] = [];

    for (const descriptor of descriptors) {
      const pixels = buildChunkPixels(map, descriptor, config);
      const source = new BufferImageSource({
        resource: pixels,
        width: descriptor.tilesW,
        height: descriptor.tilesH,
        format: 'rgba8unorm',
        scaleMode: 'nearest',
      });
      const texture = new Texture({ source });
      const sprite = new Sprite(texture);
      sprite.position.set(descriptor.tileX * TILE_WORLD_SIZE, descriptor.tileY * TILE_WORLD_SIZE);
      sprite.scale.set(TILE_WORLD_SIZE);
      this.terrainContainer.addChild(sprite);
      entries.push({ descriptor, sprite });
    }

    this.chunks = entries;
    this.chunkDescriptors = descriptors;
    this.rebuildOverlays(map);
    this.resetView();
  }

  setOverlaysVisible(visible: boolean): void {
    if (this.overlayGraphics.visible === visible) return;
    this.overlayGraphics.visible = visible;
    this.app.render();
  }

  getOverlaysVisible(): boolean {
    return this.overlayGraphics.visible;
  }

  resetView(): void {
    if (this.map === null) return;
    const { width, height } = this.viewportSize();
    this.camera = fitMapToViewport(this.map.width, this.map.height, width, height);
    this.applyCamera();
    this.callbacks.onViewChange?.();
  }

  getCamera(): CameraState {
    return this.camera;
  }

  getChunkCount(): number {
    return this.chunks.length;
  }

  getVisibleChunkCount(): number {
    return this.visibleChunkCount;
  }

  getRendererType(): string {
    return formatRendererType(this.app.renderer.type);
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.unbindEvents();
    this.destroyChunks();
    this.app.destroy(true, { children: true, texture: true, textureSource: true, context: true });
  }

  private viewportSize(): { readonly width: number; readonly height: number } {
    return {
      width: Math.max(1, this.hostEl.clientWidth),
      height: Math.max(1, this.hostEl.clientHeight),
    };
  }

  private destroyChunks(): void {
    for (const entry of this.chunks) {
      entry.sprite.destroy({ texture: true, textureSource: true });
    }
    this.terrainContainer.removeChildren();
    this.chunks = [];
    this.chunkDescriptors = [];
    this.visibleChunkCount = 0;
  }

  private rebuildOverlays(map: WorldMap): void {
    const g = this.overlayGraphics;
    g.clear();

    // Scale stroke widths and markers gently on Large/Huge maps so overlays stay readable when fitted.
    const overlayScale = Math.max(1, map.width / 128);
    const strokeW = 2 * overlayScale;

    for (const zone of map.spawnZones) {
      const color = tribeColor(zone.tribeId);
      const cx = (zone.x + 0.5) * TILE_WORLD_SIZE;
      const cy = (zone.y + 0.5) * TILE_WORLD_SIZE;
      const radiusPx = zone.radius * TILE_WORLD_SIZE;

      g.circle(cx, cy, radiusPx).stroke({ color, width: strokeW, alpha: 0.65 });
      g.circle(cx, cy, TILE_WORLD_SIZE * 0.85 * overlayScale)
        .fill({ color, alpha: 0.92 })
        .stroke({ color: 0x0b1724, width: 1.5 * overlayScale });
    }

    for (const spot of map.hotspots) {
      const cx = (spot.x + 0.5) * TILE_WORLD_SIZE;
      const cy = (spot.y + 0.5) * TILE_WORLD_SIZE;
      const auraPx = spot.radius * TILE_WORLD_SIZE;
      const r = TILE_WORLD_SIZE * 0.9 * overlayScale;

      g.circle(cx, cy, auraPx).stroke({ color: 0xfacc15, width: 1.5 * overlayScale, alpha: 0.45 });
      g.poly([cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy], true)
        .fill({ color: 0xfacc15, alpha: 0.9 })
        .stroke({ color: 0x0b1724, width: 1.5 * overlayScale });
    }
  }

  private applyCamera(): void {
    const { width, height } = this.viewportSize();
    this.worldContainer.position.set(
      width * 0.5 - this.camera.x * this.camera.zoom,
      height * 0.5 - this.camera.y * this.camera.zoom,
    );
    this.worldContainer.scale.set(this.camera.zoom);

    const visibleIds = computeVisibleChunkIndices(
      this.chunkDescriptors,
      this.camera,
      width,
      height,
    );
    this.visibleChunkCount = visibleIds.size;

    for (const entry of this.chunks) {
      entry.sprite.visible = visibleIds.has(entry.descriptor.id);
    }

    this.app.render();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.draggingPointerId !== null) return;
    this.draggingPointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.hostEl.classList.add('is-dragging');
    this.hostEl.setPointerCapture(event.pointerId);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.map === null) return;

    if (this.draggingPointerId === event.pointerId) {
      const dx = event.clientX - this.lastPointerX;
      const dy = event.clientY - this.lastPointerY;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;

      this.camera = panCamera(
        this.camera,
        dx,
        dy,
        this.map.width * TILE_WORLD_SIZE,
        this.map.height * TILE_WORLD_SIZE,
      );
      this.applyCamera();
      this.callbacks.onViewChange?.();
      return;
    }

    const rect = this.hostEl.getBoundingClientRect();
    const { width, height } = this.viewportSize();
    const tile = screenToTile(
      this.camera,
      event.clientX - rect.left,
      event.clientY - rect.top,
      width,
      height,
      this.map.width,
      this.map.height,
    );
    this.callbacks.onHoverTile?.(tile);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.draggingPointerId !== event.pointerId) return;
    this.draggingPointerId = null;
    this.hostEl.classList.remove('is-dragging');
    if (this.hostEl.hasPointerCapture(event.pointerId)) {
      this.hostEl.releasePointerCapture(event.pointerId);
    }
  };

  private readonly handlePointerLeave = (): void => {
    this.callbacks.onHoverTile?.(null);
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (this.map === null || event.deltaY === 0) return;
    event.preventDefault();

    const rect = this.hostEl.getBoundingClientRect();
    const { width, height } = this.viewportSize();
    const delta = normalizeWheelDelta(event);
    const factor = Math.pow(1.0012, -delta);
    this.camera = zoomCameraAt(
      this.camera,
      factor,
      event.clientX - rect.left,
      event.clientY - rect.top,
      width,
      height,
      this.map.width * TILE_WORLD_SIZE,
      this.map.height * TILE_WORLD_SIZE,
    );
    this.applyCamera();
    this.callbacks.onViewChange?.();
  };

  private readonly handleDoubleClick = (): void => {
    this.resetView();
  };

  private bindEvents(): void {
    this.hostEl.addEventListener('pointerdown', this.handlePointerDown);
    this.hostEl.addEventListener('pointermove', this.handlePointerMove);
    this.hostEl.addEventListener('pointerup', this.handlePointerUp);
    this.hostEl.addEventListener('pointercancel', this.handlePointerUp);
    this.hostEl.addEventListener('pointerleave', this.handlePointerLeave);
    this.hostEl.addEventListener('wheel', this.handleWheel, { passive: false });
    this.hostEl.addEventListener('dblclick', this.handleDoubleClick);
  }

  private unbindEvents(): void {
    this.hostEl.removeEventListener('pointerdown', this.handlePointerDown);
    this.hostEl.removeEventListener('pointermove', this.handlePointerMove);
    this.hostEl.removeEventListener('pointerup', this.handlePointerUp);
    this.hostEl.removeEventListener('pointercancel', this.handlePointerUp);
    this.hostEl.removeEventListener('pointerleave', this.handlePointerLeave);
    this.hostEl.removeEventListener('wheel', this.handleWheel);
    this.hostEl.removeEventListener('dblclick', this.handleDoubleClick);
  }
}
