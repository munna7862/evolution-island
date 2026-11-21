export const TILE_WORLD_SIZE = 8;

export interface CameraState {
  /** World X coordinate centered in the viewport. */
  readonly x: number;
  /** World Y coordinate centered in the viewport. */
  readonly y: number;
  /** Screen pixels per world unit. */
  readonly zoom: number;
  readonly minZoom: number;
  readonly maxZoom: number;
}

export interface TileCoord {
  readonly x: number;
  readonly y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function fitMapToViewport(
  mapWidthTiles: number,
  mapHeightTiles: number,
  viewportW: number,
  viewportH: number,
  tileWorldSize = TILE_WORLD_SIZE,
  paddingPx = 24,
): CameraState {
  const worldW = Math.max(1, mapWidthTiles * tileWorldSize);
  const worldH = Math.max(1, mapHeightTiles * tileWorldSize);
  const safeViewportW = Math.max(1, viewportW);
  const safeViewportH = Math.max(1, viewportH);
  const padX = Math.min(paddingPx, Math.max(0, (safeViewportW - 1) * 0.25));
  const padY = Math.min(paddingPx, Math.max(0, (safeViewportH - 1) * 0.25));
  const usableW = Math.max(1, safeViewportW - padX * 2);
  const usableH = Math.max(1, safeViewportH - padY * 2);

  const fitZoom = Math.min(usableW / worldW, usableH / worldH);
  const minZoom = Math.max(1e-4, Math.min(fitZoom * 0.5, 0.25));
  const maxZoom = Math.max(8, fitZoom * 16);
  const zoom = clamp(fitZoom, minZoom, maxZoom);

  return {
    x: worldW * 0.5,
    y: worldH * 0.5,
    zoom,
    minZoom,
    maxZoom,
  };
}

export function panCamera(
  camera: CameraState,
  dxScreen: number,
  dyScreen: number,
  worldWidth: number,
  worldHeight: number,
): CameraState {
  if (
    !Number.isFinite(camera.zoom) ||
    camera.zoom <= 0 ||
    !Number.isFinite(dxScreen) ||
    !Number.isFinite(dyScreen)
  ) {
    return camera;
  }
  const nextX = clamp(camera.x - dxScreen / camera.zoom, 0, worldWidth);
  const nextY = clamp(camera.y - dyScreen / camera.zoom, 0, worldHeight);
  return {
    ...camera,
    x: nextX,
    y: nextY,
  };
}

export function zoomCameraAt(
  camera: CameraState,
  factor: number,
  screenX: number,
  screenY: number,
  viewportW: number,
  viewportH: number,
  worldWidth: number,
  worldHeight: number,
): CameraState {
  if (
    !Number.isFinite(camera.zoom) ||
    camera.zoom <= 0 ||
    !Number.isFinite(factor) ||
    factor <= 0 ||
    !Number.isFinite(screenX) ||
    !Number.isFinite(screenY)
  ) {
    return camera;
  }

  const nextZoom = clamp(camera.zoom * factor, camera.minZoom, camera.maxZoom);
  if (nextZoom === camera.zoom) {
    return camera;
  }

  // World point currently under (screenX, screenY).
  const anchorWorldX = camera.x + (screenX - viewportW * 0.5) / camera.zoom;
  const anchorWorldY = camera.y + (screenY - viewportH * 0.5) / camera.zoom;

  // Adjust camera center so anchorWorld stays at (screenX, screenY) under nextZoom.
  const nextX = clamp(anchorWorldX - (screenX - viewportW * 0.5) / nextZoom, 0, worldWidth);
  const nextY = clamp(anchorWorldY - (screenY - viewportH * 0.5) / nextZoom, 0, worldHeight);

  return {
    ...camera,
    x: nextX,
    y: nextY,
    zoom: nextZoom,
  };
}

export function screenToTile(
  camera: CameraState,
  screenX: number,
  screenY: number,
  viewportW: number,
  viewportH: number,
  mapWidthTiles: number,
  mapHeightTiles: number,
  tileWorldSize = TILE_WORLD_SIZE,
): TileCoord | null {
  if (
    !Number.isFinite(camera.zoom) ||
    camera.zoom <= 0 ||
    !Number.isFinite(tileWorldSize) ||
    tileWorldSize <= 0
  ) {
    return null;
  }

  const worldX = camera.x + (screenX - viewportW * 0.5) / camera.zoom;
  const worldY = camera.y + (screenY - viewportH * 0.5) / camera.zoom;
  const tileX = Math.floor(worldX / tileWorldSize);
  const tileY = Math.floor(worldY / tileWorldSize);

  if (!(tileX >= 0 && tileX < mapWidthTiles && tileY >= 0 && tileY < mapHeightTiles)) {
    return null;
  }
  return { x: tileX, y: tileY };
}
