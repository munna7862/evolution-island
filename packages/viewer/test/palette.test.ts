import { Biome, DEFAULT_CONFIG } from '@evolution-island/sim-core';
import { describe, expect, it } from 'vitest';
import {
  BIOME_COLORS,
  BIOME_LEGEND,
  tileColorRgb,
  TRIBE_COLORS,
  TRIBE_NAMES,
  TRIBE_SHAPES,
  tribeColor,
  tribeHex,
  tribeName,
  tribeShape,
} from '../src/renderer/palette.js';

describe('palette helpers', () => {
  it('exposes legend entries for all 6 biomes', () => {
    expect(BIOME_LEGEND).toHaveLength(6);
    for (const item of BIOME_LEGEND) {
      expect(item.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('wraps tribeColor, tribeHex, tribeName, and tribeShape safely across tribe IDs', () => {
    expect(tribeColor(0)).toBe(TRIBE_COLORS[0]);
    expect(tribeColor(-1)).toBe(TRIBE_COLORS[TRIBE_COLORS.length - 1]);
    expect(tribeColor(TRIBE_COLORS.length + 2)).toBe(TRIBE_COLORS[2]);
    expect(tribeColor(2.9)).toBe(TRIBE_COLORS[2]);
    expect(tribeColor(Number.NaN)).toBe(TRIBE_COLORS[0]);

    expect(TRIBE_NAMES).toHaveLength(8);
    expect(TRIBE_SHAPES).toHaveLength(8);
    expect(tribeName(0)).toBe('Amber');
    expect(tribeName(-1)).toBe('Ivory');
    expect(tribeName(Number.NaN)).toBe('Amber');
    expect(tribeHex(0)).toBe('#e69f00');
    expect(tribeHex(7)).toBe('#ffffff');
    expect(tribeShape(0)).toBe('circle');
    expect(tribeShape(9)).toBe('diamond');
  });

  it('shades Grass and Forest relative to their own base food without falsely tinting moist Forest as hotspot', () => {
    const mapCfg = DEFAULT_CONFIG.map;
    const baseGrass = mapCfg.biomeMaxFood[Biome.Grass];
    const baseForest = mapCfg.biomeMaxFood[Biome.Forest];

    // Baseline Grass matches legend swatch exactly.
    expect(tileColorRgb(Biome.Grass, baseGrass, mapCfg)).toEqual(BIOME_COLORS[Biome.Grass]);

    // Moist Forest at normalMax (100 * 1.2 = 120) differs from dry Forest (100 * 0.8 = 80),
    // and does NOT jump toward the gold hotspot tint (blue channel stays darker than grass/gold).
    const dryForest = tileColorRgb(Biome.Forest, 80, mapCfg);
    const baseForestColor = tileColorRgb(Biome.Forest, baseForest, mapCfg);
    const moistForest = tileColorRgb(Biome.Forest, 120, mapCfg);
    expect(dryForest).not.toEqual(baseForestColor);
    expect(moistForest).not.toEqual(baseForestColor);
    expect(moistForest[0]).toBeLessThan(80); // Not gold-tinted!

    // Hotspot-boosted Sand, Grass, and Forest receive warm gold tinting (red channel rises strongly).
    const hotspotSand = tileColorRgb(Biome.Sand, 75, mapCfg);
    const hotspotGrass = tileColorRgb(Biome.Grass, 120, mapCfg);
    const hotspotForest = tileColorRgb(Biome.Forest, 155, mapCfg);
    expect(hotspotSand[2]).toBeLessThan(BIOME_COLORS[Biome.Sand][2]);
    expect(hotspotGrass[0]).toBeGreaterThan(BIOME_COLORS[Biome.Grass][0] + 20);
    expect(hotspotForest[0]).toBeGreaterThan(moistForest[0] + 40);

    // Custom config thresholds are respected.
    const customCfg = {
      ...mapCfg,
      biomeMaxFood: [0, 0, 15, 200, 250, 0] as const,
      hotspotMaxFood: 400,
    };
    expect(tileColorRgb(Biome.Grass, 200, customCfg)).toEqual(BIOME_COLORS[Biome.Grass]);
  });
});
