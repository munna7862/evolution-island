import type { CreatureBuffer } from '@evolution-island/shared';
import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { TILE_WORLD_SIZE } from './camera.js';
import { computeInterpolationAlpha, lerp } from './interpolation.js';
import { TRIBE_SHAPES, tribeHex, tribeShape, type TribeShape } from './palette.js';

const TEXTURE_SIZE = 32;
const CREATURE_WORLD_SIZE = TILE_WORLD_SIZE * 0.9;
/** One ripple (Sprint 4.3): a ring around a calling creature grows and fades over this time. */
export const RIPPLE_PERIOD_MS = 900;
/** The ring grows from the creature's size to this many times it. */
const RIPPLE_MAX_SCALE = 3.5;

/** A white ring, tinted per tribe; its strength fades the alpha. */
export function createRippleTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE * 2;
  canvas.height = TEXTURE_SIZE * 2;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Failed to acquire 2D canvas context for the ripple texture');
  }
  ctx.beginPath();
  ctx.arc(TEXTURE_SIZE, TEXTURE_SIZE, TEXTURE_SIZE - 3, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  return new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'linear' }) });
}

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
  /** Ripple rings of calling creatures; the map view puts it under `container`. */
  readonly rippleContainer = new Container();

  private readonly tribeTextures: Texture[];
  private readonly spritePool: Sprite[] = [];
  private readonly rippleTexture: Texture;
  private readonly ripplePool: Sprite[] = [];
  /** Per ripple in use: the creature (snapshot index) it belongs to and its call strength. */
  private ripples: { readonly index: number; readonly strength: number }[] = [];

  private snapshot: CreatureBuffer | null = null;
  private receivedAtMs = 0;
  private tickDurationMs = 0;
  private running = false;
  private renderedCount = 0;
  private lastAlpha = -1;
  private positionChanged = false;

  constructor(
    textureFactory: (tribeIdx: number) => Texture = createTribeTexture,
    rippleFactory: () => Texture = createRippleTexture,
  ) {
    this.tribeTextures = TRIBE_SHAPES.map((_, idx) => textureFactory(idx));
    this.rippleTexture = rippleFactory();
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

    this.setRipples(creatures);
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

    if (this.ripples.length > 0) {
      this.updateRipples(nowMs);
      this.positionChanged = true;
    }
    return changed || (this.running && alpha < 1) || this.ripples.length > 0;
  }

  /** Calling creatures in the latest snapshot (for tests and the HUD). */
  getRippleCount(): number {
    return this.ripples.length;
  }

  private setRipples(creatures: CreatureBuffer): void {
    this.ripples = [];
    for (let i = 0; i < creatures.count; i++) {
      const call = creatures.call[i]!;
      if (call > 0) this.ripples.push({ index: i, strength: call / 255 });
    }
    while (this.ripplePool.length < this.ripples.length) {
      const ring = new Sprite(this.rippleTexture);
      ring.anchor.set(0.5);
      this.rippleContainer.addChild(ring);
      this.ripplePool.push(ring);
    }
    const tribeCount = this.tribeTextures.length;
    this.ripples.forEach((ripple, k) => {
      const rawTribe = creatures.tribeIds[ripple.index]!;
      this.ripplePool[k]!.tint = tribeHex(((rawTribe % tribeCount) + tribeCount) % tribeCount);
      this.ripplePool[k]!.visible = true;
    });
    for (let k = this.ripples.length; k < this.ripplePool.length; k++) {
      this.ripplePool[k]!.visible = false;
    }
  }

  /** Rings follow their creature, grow from 1× to RIPPLE_MAX_SCALE× its size and fade out. */
  private updateRipples(nowMs: number): void {
    const elapsed = Math.max(0, nowMs - this.receivedAtMs);
    const phase = (elapsed % RIPPLE_PERIOD_MS) / RIPPLE_PERIOD_MS;
    const size = CREATURE_WORLD_SIZE * (1 + (RIPPLE_MAX_SCALE - 1) * phase);
    this.ripples.forEach((ripple, k) => {
      const ring = this.ripplePool[k]!;
      const sprite = this.spritePool[ripple.index]!;
      ring.position.set(sprite.position.x, sprite.position.y);
      ring.width = size;
      ring.height = size;
      ring.alpha = ripple.strength * (1 - phase);
    });
  }

  didPositionChange(): boolean {
    return this.positionChanged;
  }

  getRenderedCount(): number {
    return this.renderedCount;
  }

  clear(): void {
    this.snapshot = null;
    this.ripples = [];
    for (const ring of this.ripplePool) {
      ring.visible = false;
    }
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
    for (const ring of this.ripplePool) {
      ring.destroy();
    }
    this.ripplePool.length = 0;
    this.rippleTexture.destroy(true);
    for (const tex of this.tribeTextures) {
      tex.destroy(true);
    }
    this.tribeTextures.length = 0;
  }
}
