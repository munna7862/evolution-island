import { Biome, DEFAULT_CONFIG, type MapGenConfig } from '@evolution-island/sim-core';

export type Rgb = readonly [number, number, number];

export interface BiomeLegendItem {
  readonly biome: Biome;
  readonly label: string;
  readonly hex: string;
}

/** Cartographic base RGB colors for each biome. */
export const BIOME_COLORS: Readonly<Record<Biome, Rgb>> = {
  [Biome.DeepWater]: [18, 59, 99],
  [Biome.ShallowWater]: [46, 128, 173],
  [Biome.Sand]: [216, 198, 144],
  [Biome.Grass]: [98, 166, 78],
  [Biome.Forest]: [44, 108, 57],
  [Biome.Mountain]: [118, 124, 133],
};

export const BIOME_NAMES: Readonly<Record<Biome, string>> = {
  [Biome.DeepWater]: 'Deep Water',
  [Biome.ShallowWater]: 'Shallow Water',
  [Biome.Sand]: 'Sand',
  [Biome.Grass]: 'Grass',
  [Biome.Forest]: 'Forest',
  [Biome.Mountain]: 'Mountain',
};

function rgbToHex([r, g, b]: Rgb): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export const BIOME_LEGEND: readonly BiomeLegendItem[] = [
  Biome.DeepWater,
  Biome.ShallowWater,
  Biome.Sand,
  Biome.Grass,
  Biome.Forest,
  Biome.Mountain,
].map((biome) => ({
  biome,
  label: BIOME_NAMES[biome],
  hex: rgbToHex(BIOME_COLORS[biome]),
}));

/**
 * Okabe-Ito-inspired color-blind-safe palette for up to 8 tribes (plan §10).
 */
export const TRIBE_COLORS: readonly number[] = [
  0xe69f00, // orange
  0x56b4e9, // sky blue
  0xd55e00, // vermilion
  0xcc79a7, // reddish purple
  0xf0e442, // yellow
  0x009e73, // bluish green
  0x0072b2, // blue
  0xffffff, // white
];

export function tribeColor(tribeId: number): number {
  const len = TRIBE_COLORS.length;
  const normalized = Number.isFinite(tribeId) ? Math.trunc(tribeId) : 0;
  return TRIBE_COLORS[((normalized % len) + len) % len]!;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Computes a deterministic RGBA color (RGB tuple; alpha is always 255) for a tile,
 * shading Grass/Forest relative to each biome's own base food and highlighting contested
 * hotspots (tiles exceeding normal moisture-modulated maxFood) with a warm gold tint.
 */
export function tileColorRgb(
  biome: number,
  maxFood: number,
  mapConfig: MapGenConfig = DEFAULT_CONFIG.map,
): Rgb {
  const base = (BIOME_COLORS as Record<number, Rgb>)[biome] ?? BIOME_COLORS[Biome.DeepWater];
  if (biome !== Biome.Grass && biome !== Biome.Forest && biome !== Biome.Sand) {
    return base;
  }

  const biomeBase = mapConfig.biomeMaxFood[biome];
  let r = base[0];
  let g = base[1];
  let b = base[2];

  if ((biome === Biome.Grass || biome === Biome.Forest) && biomeBase > 0) {
    const ratio = Math.max(0.6, Math.min(1.4, maxFood / biomeBase));
    const shade = 1 + (ratio - 1) * 0.35;
    r *= shade;
    g *= shade;
    b *= shade;
  }

  const normalMax =
    biome === Biome.Grass || biome === Biome.Forest
      ? Math.round(biomeBase * (1 + mapConfig.moistureFoodBonus))
      : biomeBase;

  // Highlight tiles boosted above normal biome max (contested hotspots).
  if (maxFood > normalMax && mapConfig.hotspotMaxFood > normalMax) {
    const t = Math.max(
      0,
      Math.min(1, (maxFood - normalMax) / (mapConfig.hotspotMaxFood - normalMax)),
    );
    r = r + (222 - r) * (0.45 * t);
    g = g + (206 - g) * (0.35 * t);
    b = b + (74 - b) * (0.35 * t);
  }

  return [clampByte(r), clampByte(g), clampByte(b)];
}
