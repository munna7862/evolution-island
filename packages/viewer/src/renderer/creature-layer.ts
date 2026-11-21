import type { CreatureBuffer } from '@evolution-island/shared';
import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { TILE_WORLD_SIZE } from './camera.js';
import { computeInterpolationAlpha, lerp } from './interpolation.js';
import { TRIBE_SHAPES, tribeHex, tribeShape, type TribeShape } from './palette.js';

const TEXTURE_SIZE = 32;
const CREATURE_WORLD_SIZE = TILE_WORLD_SIZE * 0.9;

function traceRegularPolygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotationRad = -Math.PI / 2,
): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = rotationRad + (i * 2 * Math.PI) / sides;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function traceShapePath(ctx: CanvasRenderingContext2D, shape: TribeShape, size: number): void {
  const half = size * 0.5;
  const r = size * 0.38;

  switch (shape) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(half, half, r, 0, Math.PI * 2);
      ctx.closePath();
      break;
    case 'diamond':
      traceRegularPolygon(ctx, half, half, r, 4, 0);
      break;
    case 'triangle':
      traceRegularPolygon(ctx, half, half + 1, r, 3, -Math.PI / 2);
      break;
    case 'square': {
      const s = r * 1.65;
      ctx.beginPath();
      ctx.rect(half - s * 0.5, half - s * 0.5, s, s);
      ctx.closePath();
      break;
    }
    case 'pentagon':
      traceRegularPolygon(ctx, half, half, r, 5, -Math.PI / 2);
      break;
    case 'hexagon':
      traceRegularPolygon(ctx, half, half, r, 6, 0);
      break;
    case 'star': {
      ctx.beginPath();
      const points = 5;
      const innerR = r * 0.46;
      for (let i = 0; i < points * 2; i++) {
        const rad = i % 2 === 0 ? r : innerR;
        const angle = -Math.PI / 2 + (i * Math.PI) / points;
        const px = half + Math.cos(angle) * rad;
        const py = half + Math.sin(angle) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'cross': {
      const arm = r * 0.36;
      ctx.beginPath();
      ctx.moveTo(half - arm, half - r);
      ctx.lineTo(half + arm, half - r);
      ctx.lineTo(half + arm, half - arm);
      ctx.lineTo(half + r, half - arm);
      ctx.lineTo(half + r, half + arm);
      ctx.lineTo(half + arm, half + arm);
      ctx.lineTo(half + arm, half + r);
      ctx.lineTo(half - arm, half + r);
      ctx.lineTo(half - arm, half + arm);
      ctx.lineTo(half - r, half + arm);
      ctx.lineTo(half - r, half - arm);
      ctx.lineTo(half - arm, half - arm);
      ctx.closePath();
      break;
    }
  }
}

function createTribeTexture(tribeIdx: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Failed to acquire 2D canvas context for creature sprite texture');
  }

  ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  traceShapePath(ctx, tribeShape(tribeIdx), TEXTURE_SIZE);
  ctx.fillStyle = tribeHex(tribeIdx);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#08111c';
  ctx.stroke();

  const source = new CanvasSource({
    resource: canvas,
    scaleMode: 'linear',
  });
  return new Texture({ source });
}

export class CreatureLayer {
  readonly container = new Container();

  private readonly tribeTextures: Texture[];
  private readonly spritePool: Sprite[] = [];

  private snapshot: CreatureBuffer | null = null;
  private receivedAtMs = 0;
  private tickDurationMs = 0;
  private running = false;
  private renderedCount = 0;
  private lastAlpha = -1;
  private positionChanged = false;

  constructor(textureFactory: (tribeIdx: number) => Texture = createTribeTexture) {
    this.tribeTextures = TRIBE_SHAPES.map((_, idx) => textureFactory(idx));
  }

  setSnapshot(
    creatures: CreatureBuffer,
    receivedAtMs: number,
    tickDurationMs: number,
    running: boolean,
  ): void {
    this.snapshot = creatures;
    this.receivedAtMs = receivedAtMs;
    this.tickDurationMs = tickDurationMs;
    this.running = running;
    this.renderedCount = creatures.count;
    this.lastAlpha = -1;

    while (this.spritePool.length < creatures.count) {
      const sprite = new Sprite(this.tribeTextures[0]);
      sprite.anchor.set(0.5);
      sprite.width = CREATURE_WORLD_SIZE;
      sprite.height = CREATURE_WORLD_SIZE;
      this.container.addChild(sprite);
      this.spritePool.push(sprite);
    }

    const tribeCount = this.tribeTextures.length;
    for (let i = 0; i < creatures.count; i++) {
      const sprite = this.spritePool[i]!;
      const rawTribe = creatures.tribeIds[i]!;
      const tribeIdx = ((rawTribe % tribeCount) + tribeCount) % tribeCount;
      sprite.texture = this.tribeTextures[tribeIdx]!;
      sprite.alpha = 0.45 + 0.55 * (creatures.healthRatio[i]! / 255);
      sprite.visible = true;
    }

    for (let i = creatures.count; i < this.spritePool.length; i++) {
      this.spritePool[i]!.visible = false;
    }

    this.updateInterpolation(receivedAtMs);
  }

  updateInterpolation(nowMs: number): boolean {
    const snap = this.snapshot;
    if (snap === null || snap.count === 0) {
      this.positionChanged = false;
      return false;
    }

    const alpha = computeInterpolationAlpha(
      nowMs - this.receivedAtMs,
      this.tickDurationMs,
      this.running,
    );
    const changed = alpha !== this.lastAlpha;
    this.positionChanged = changed;

    if (changed) {
      const { prevX, prevY, x, y, count } = snap;
      for (let i = 0; i < count; i++) {
        const sprite = this.spritePool[i]!;
        const wx = (lerp(prevX[i]!, x[i]!, alpha) + 0.5) * TILE_WORLD_SIZE;
        const wy = (lerp(prevY[i]!, y[i]!, alpha) + 0.5) * TILE_WORLD_SIZE;
        sprite.position.set(wx, wy);
      }
      this.lastAlpha = alpha;
    }

    return changed || (this.running && alpha < 1);
  }

  didPositionChange(): boolean {
    return this.positionChanged;
  }

  getRenderedCount(): number {
    return this.renderedCount;
  }

  clear(): void {
    this.snapshot = null;
    this.renderedCount = 0;
    this.lastAlpha = -1;
    this.positionChanged = false;
    for (const sprite of this.spritePool) {
      sprite.visible = false;
    }
  }

  destroy(): void {
    this.clear();
    for (const sprite of this.spritePool) {
      sprite.destroy();
    }
    this.spritePool.length = 0;
    for (const tex of this.tribeTextures) {
      tex.destroy(true);
    }
    this.tribeTextures.length = 0;
  }
}
