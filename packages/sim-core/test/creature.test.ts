import { describe, expect, it } from 'vitest';
import { applyMetabolism, createCreature, DEFAULT_CONFIG, NO_MOVE_DIR } from '../src/index.js';

const CFG = DEFAULT_CONFIG.creature;

describe('creature metabolism', () => {
  it('initializes creatures at max stats', () => {
    const c = createCreature(0, 1, 10, 12, CFG);
    expect(c.health).toBe(CFG.maxHealth);
    expect(c.energy).toBe(CFG.maxEnergy);
    expect(c.hydration).toBe(CFG.maxHydration);
    expect(c.age).toBe(0);
    expect(c.alive).toBe(true);
    expect(c.lastMoveDir).toBe(NO_MOVE_DIR);
  });

  it('drains energy and hydration every tick and clamps at 0', () => {
    const c = createCreature(0, 0, 5, 5, CFG);
    applyMetabolism(c, CFG, 1000);
    expect(c.energy).toBeCloseTo(CFG.maxEnergy - CFG.baseEnergyDrain, 10);
    expect(c.hydration).toBeCloseTo(CFG.maxHydration - CFG.baseHydrationDrain, 10);
    expect(c.age).toBe(1);
    expect(c.stats.ticksAlive).toBe(1);

    c.energy = 0.05;
    c.hydration = 0.05;
    applyMetabolism(c, CFG, 1000);
    expect(c.energy).toBe(0);
    expect(c.hydration).toBe(0);
  });

  it('drains health on starvation, dehydration, and doubly when both are zero', () => {
    const starv = createCreature(0, 0, 0, 0, CFG);
    starv.energy = 0;
    starv.hydration = 80;
    applyMetabolism(starv, CFG, 1000);
    expect(starv.health).toBeCloseTo(CFG.maxHealth - CFG.starvationHealthDrain, 10);

    const dehyd = createCreature(1, 0, 0, 0, CFG);
    dehyd.energy = 80;
    dehyd.hydration = 0;
    applyMetabolism(dehyd, CFG, 1000);
    expect(dehyd.health).toBeCloseTo(CFG.maxHealth - CFG.dehydrationHealthDrain, 10);

    const both = createCreature(2, 0, 0, 0, CFG);
    both.energy = 0;
    both.hydration = 0;
    applyMetabolism(both, CFG, 1000);
    expect(both.health).toBeCloseTo(
      CFG.maxHealth - CFG.starvationHealthDrain - CFG.dehydrationHealthDrain,
      10,
    );
  });

  it('regenerates health only when both energy and hydration are strictly above 50% and clamps to maxHealth', () => {
    const c = createCreature(0, 0, 0, 0, CFG);
    c.health = 80;
    c.energy = 60;
    c.hydration = 60;
    applyMetabolism(c, CFG, 1000);
    expect(c.health).toBeCloseTo(80 + CFG.healthRegenRate, 10);

    // Exact 50% boundary after drain (energy = 50, hydration = 50) -> must NOT regenerate.
    c.health = 80;
    c.energy = CFG.maxEnergy * CFG.regenThresholdRatio + CFG.baseEnergyDrain;
    c.hydration = CFG.maxHydration * CFG.regenThresholdRatio + CFG.baseHydrationDrain;
    applyMetabolism(c, CFG, 1000);
    expect(c.energy).toBeCloseTo(50, 10);
    expect(c.hydration).toBeCloseTo(50, 10);
    expect(c.health).toBe(80);

    // Never exceeds maxHealth.
    c.health = CFG.maxHealth - 0.05;
    c.energy = 90;
    c.hydration = 90;
    applyMetabolism(c, CFG, 1000);
    expect(c.health).toBe(CFG.maxHealth);
  });

  it('kills a creature standing still without eating or drinking well before 600 ticks', () => {
    const c = createCreature(0, 0, 0, 0, CFG);
    let ticks = 0;
    while (c.alive && ticks < 1500) {
      applyMetabolism(c, CFG, 3000);
      ticks++;
    }
    expect(c.alive).toBe(false);
    expect(c.health).toBe(0);
    expect(ticks).toBeLessThan(600);
    // Exact balance verification: hydration=0 at tick 334 (health −0.5/tick), energy=0 at tick 500
    // (health −1/tick from then on) -> death at tick 516.
    expect(ticks).toBe(516);
  });

  it('kills creatures at maxAge, ignores maxAge <= 0, handles health <= 0, and treats dead creatures as no-op', () => {
    const c = createCreature(0, 0, 0, 0, CFG);
    expect(applyMetabolism(c, CFG, 3)).toBe(false);
    expect(applyMetabolism(c, CFG, 3)).toBe(false);
    expect(applyMetabolism(c, CFG, 3)).toBe(true);
    expect(c.alive).toBe(false);
    expect(c.health).toBe(0);
    expect(c.age).toBe(3);
    expect(c.stats.ticksAlive).toBe(2);

    // Further calls are no-op.
    expect(applyMetabolism(c, CFG, 3)).toBe(false);
    expect(c.age).toBe(3);

    // maxAge <= 0 disables old-age death.
    const immortal = createCreature(1, 0, 0, 0, CFG);
    expect(applyMetabolism(immortal, CFG, 0)).toBe(false);
    expect(immortal.alive).toBe(true);

    // Health <= 0 while alive kills cleanly on metabolism.
    const zeroHp = createCreature(2, 0, 0, 0, CFG);
    zeroHp.health = 0;
    expect(applyMetabolism(zeroHp, CFG, 100)).toBe(true);
    expect(zeroHp.alive).toBe(false);
  });
});
