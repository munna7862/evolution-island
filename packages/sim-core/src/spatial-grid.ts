import type { Creature } from './creature.js';

/**
 * Allocation-free uniform spatial hash grid backed by flat Int32Array linked lists.
 * Rebuilt once per tick before Phase A so nearest-ally/enemy queries scan only local cells.
 */
export class SpatialGrid {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;

  private readonly head: Int32Array;
  private next: Int32Array;
  private creatures: readonly Creature[] = [];

  constructor(width: number, height: number, cellSize: number) {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      !Number.isFinite(cellSize) ||
      cellSize <= 0
    ) {
      throw new RangeError(
        `SpatialGrid requires positive integer dimensions and cellSize > 0, received ${width}x${height} (cellSize=${cellSize})`,
      );
    }

    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.head = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(0);
  }

  /**
   * Returns a read-only view of the per-cell linked-list heads (`-1` for empty cells).
   */
  getHead(): Int32Array {
    return this.head;
  }

  /**
   * Returns a read-only view of the per-creature linked-list next indices (`-1` at list end).
   */
  getNext(): Int32Array {
    return this.next;
  }

  getCreatures(): readonly Creature[] {
    return this.creatures;
  }

  /**
   * Rebuilds the grid with all living creatures. Expects living creature coordinates within
   * `[0, width) × [0, height)` (non-finite coordinates are skipped). Iterates in reverse index
   * order so each cell's linked list yields creatures in ascending index order.
   */
  rebuild(creatures: readonly Creature[]): void {
    this.creatures = creatures;
    this.head.fill(-1);

    if (creatures.length > this.next.length) {
      this.next = new Int32Array(creatures.length);
    }

    const { cols, rows, cellSize, head, next } = this;
    const maxCol = cols - 1;
    const maxRow = rows - 1;

    for (let i = creatures.length - 1; i >= 0; i--) {
      const c = creatures[i]!;
      if (!c.alive || !Number.isFinite(c.x) || !Number.isFinite(c.y)) {
        next[i] = -1;
        continue;
      }
      const cx = Math.max(0, Math.min(maxCol, Math.floor(c.x / cellSize)));
      const cy = Math.max(0, Math.min(maxRow, Math.floor(c.y / cellSize)));
      const cellIdx = cy * cols + cx;
      next[i] = head[cellIdx]!;
      head[cellIdx] = i;
    }
  }

  /**
   * Visits all living creatures within Euclidean `radius` of (x, y).
   */
  queryRadius(x: number, y: number, radius: number, visitor: (creature: Creature) => void): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) {
      return;
    }

    const { cols, rows, cellSize, head, next, creatures } = this;
    const minCx = Math.max(0, Math.floor((x - radius) / cellSize));
    const maxCx = Math.min(cols - 1, Math.floor((x + radius) / cellSize));
    const minCy = Math.max(0, Math.floor((y - radius) / cellSize));
    const maxCy = Math.min(rows - 1, Math.floor((y + radius) / cellSize));
    const r2 = radius * radius;

    for (let cy = minCy; cy <= maxCy; cy++) {
      const rowOffset = cy * cols;
      for (let cx = minCx; cx <= maxCx; cx++) {
        let idx = head[rowOffset + cx]!;
        while (idx !== -1) {
          const c = creatures[idx]!;
          if (c.alive) {
            const dx = c.x - x;
            const dy = c.y - y;
            if (dx * dx + dy * dy <= r2) {
              visitor(c);
            }
          }
          idx = next[idx]!;
        }
      }
    }
  }
}
