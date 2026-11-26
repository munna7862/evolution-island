import type { BrainSpec } from './brain.js';
import type { NeatConfig } from './config.js';
import type { RngStream } from './rng.js';

/**
 * NEAT brains (plan §4 Phase 8): the topology evolves with the weights (Stanley & Miikkulainen,
 * "Evolving Neural Networks through Augmenting Topologies", 2002), adapted to this simulation:
 *
 * - The same inputs and outputs as the MLP (sensors, memory, calls; actions, memory, call), so a
 *   NEAT brain drops into the same policy. Hidden nodes squash with softsign; outputs are linear
 *   sums, as in the MLP. The constant sensor 17 is the bias input.
 * - Feed-forward only: a connection may never close a cycle (memory gives recurrence).
 * - A genome starts with every input connected to every output. Mutations perturb weights, toggle
 *   connections, add a connection, or split an enabled connection a→b with a hidden node n
 *   (a→n weight 1, n→b the old weight, a→b disabled).
 * - Historical markings: a connection is identified by its (from, to) pair, and a hidden node by
 *   the connection it split, recorded in the genome. So the same split gives the same node id in
 *   every genome of a run (`NeatRegistry`), and crossover can line genes up without a global
 *   innovation counter in the run state.
 * - Crossover keeps the fitter parent's structure; matching connections take their weight and
 *   on/off state from either parent (one coin each). Tribes are the species: no speciation.
 *
 * Genomes stay flat `Float32Array`s (whole numbers below 2^24 are exact in float32), so run files,
 * replays, hashes and the family tree handle them like MLP genomes:
 *
 *   [0] H hidden nodes, [1] C connections,
 *   then H × (id, splitFrom, splitTo), ids ascending,
 *   then C × (from, to, weight, enabled 0/1), sorted by (from, to), no duplicates.
 *
 * Node ids: inputs 0..I−1, outputs I..I+O−1, hidden nodes from I+O.
 */

/** Brain format of NEAT genomes (the MLP is format 1). */
export const NEAT_FORMAT_VERSION = 2;

/** Node ids must stay exact in float32. */
const MAX_NODE_ID = 1 << 24;
const HEADER = 2;
const NODE_FIELDS = 3;
const CONN_FIELDS = 4;

export interface NeatNode {
  readonly id: number;
  readonly splitFrom: number;
  readonly splitTo: number;
}

export interface NeatConnection {
  readonly from: number;
  readonly to: number;
  weight: number;
  enabled: boolean;
}

export interface NeatGenome {
  readonly hidden: NeatNode[];
  readonly connections: NeatConnection[];
}

/** Mutation settings of NEAT genomes: weight noise as for the MLP, plus structure. */
export interface NeatMutation {
  readonly rate: number;
  readonly sigma: number;
  readonly clamp: number;
  /** Weights of new connections are uniform in ±this. */
  readonly initialWeightRange: number;
  readonly neat: NeatConfig;
}

function softsign(x: number): number {
  return x / (1 + Math.abs(x));
}

const isOutput = (spec: BrainSpec, id: number): boolean =>
  id >= spec.inputs && id < spec.inputs + spec.outputs;
const isInput = (spec: BrainSpec, id: number): boolean => id < spec.inputs;
const firstHiddenId = (spec: BrainSpec): number => spec.inputs + spec.outputs;

function compareConnections(a: NeatConnection, b: NeatConnection): number {
  return a.from !== b.from ? a.from - b.from : a.to - b.to;
}

export function encodeNeat(genome: NeatGenome): Float32Array {
  const { hidden, connections } = genome;
  const out = new Float32Array(
    HEADER + NODE_FIELDS * hidden.length + CONN_FIELDS * connections.length,
  );
  out[0] = hidden.length;
  out[1] = connections.length;
  let k = HEADER;
  for (const n of hidden) {
    out[k++] = n.id;
    out[k++] = n.splitFrom;
    out[k++] = n.splitTo;
  }
  for (const c of connections) {
    out[k++] = c.from;
    out[k++] = c.to;
    out[k++] = c.weight;
    out[k++] = c.enabled ? 1 : 0;
  }
  return out;
}

/** Decodes without checks; use `validateNeatGenome` first on untrusted data. */
export function decodeNeat(genome: Float32Array): NeatGenome {
  const h = genome[0]!;
  const c = genome[1]!;
  const hidden: NeatNode[] = [];
  let k = HEADER;
  for (let i = 0; i < h; i++, k += NODE_FIELDS) {
    hidden.push({ id: genome[k]!, splitFrom: genome[k + 1]!, splitTo: genome[k + 2]! });
  }
  const connections: NeatConnection[] = [];
  for (let i = 0; i < c; i++, k += CONN_FIELDS) {
    connections.push({
      from: genome[k]!,
      to: genome[k + 1]!,
      weight: genome[k + 2]!,
      enabled: genome[k + 3]! === 1,
    });
  }
  return { hidden, connections };
}

function isId(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < MAX_NODE_ID;
}

/**
 * Throws unless `genome` is a well-formed NEAT genome of `spec`: the layout above, at most
 * `spec.hidden` hidden nodes, connections only from inputs/hidden to hidden/outputs between nodes
 * that exist, finite weights, and no cycle.
 */
export function validateNeatGenome(spec: BrainSpec, genome: Float32Array): void {
  const fail = (why: string): never => {
    throw new RangeError(`Invalid NEAT genome: ${why}`);
  };
  if (genome.length < HEADER) fail('too short');
  const h = genome[0]!;
  const c = genome[1]!;
  if (!Number.isInteger(h) || h < 0 || !Number.isInteger(c) || c < 0) fail('bad counts');
  if (h > spec.hidden) fail(`${h} hidden nodes, the brain allows ${spec.hidden}`);
  if (genome.length !== HEADER + NODE_FIELDS * h + CONN_FIELDS * c) {
    fail(`length ${genome.length} does not match ${h} nodes and ${c} connections`);
  }
  const { hidden, connections } = decodeNeat(genome);
  const hiddenIds = new Set<number>();
  let lastId = -1;
  for (const n of hidden) {
    if (!isId(n.id) || n.id < firstHiddenId(spec)) fail(`bad hidden node id ${n.id}`);
    if (n.id <= lastId) fail('hidden node ids must ascend');
    if (!isId(n.splitFrom) || !isId(n.splitTo)) fail(`bad split of node ${n.id}`);
    lastId = n.id;
    hiddenIds.add(n.id);
  }
  const exists = (id: number): boolean =>
    isInput(spec, id) || isOutput(spec, id) || hiddenIds.has(id);
  let prev: NeatConnection | null = null;
  for (const conn of connections) {
    if (!isId(conn.from) || !isId(conn.to) || !exists(conn.from) || !exists(conn.to)) {
      fail(`connection ${conn.from}→${conn.to} uses a node that does not exist`);
    }
    if (isOutput(spec, conn.from) || isInput(spec, conn.to) || conn.from === conn.to) {
      fail(`connection ${conn.from}→${conn.to} goes the wrong way`);
    }
    if (!Number.isFinite(conn.weight)) fail(`weight of ${conn.from}→${conn.to} is not finite`);
    if (prev !== null && compareConnections(prev, conn) >= 0) {
      fail('connections must be sorted by (from, to) without duplicates');
    }
    prev = conn;
  }
  for (let i = 0; i < c; i++) {
    const flag = genome[HEADER + NODE_FIELDS * h + CONN_FIELDS * i + 3]!;
    if (flag !== 0 && flag !== 1) fail('enabled flags must be 0 or 1');
  }
  if (hiddenOrder(hidden, connections) === null) fail('connections form a cycle');
}

/**
 * Hidden node ids in evaluation order (Kahn's algorithm over all connections, enabled or not,
 * lowest id first among the ready ones), or null if the connections form a cycle.
 */
function hiddenOrder(
  hidden: readonly NeatNode[],
  connections: readonly NeatConnection[],
): number[] | null {
  const pending = new Map<number, number>(hidden.map((n) => [n.id, 0]));
  for (const c of connections) {
    if (pending.has(c.to) && pending.has(c.from)) pending.set(c.to, pending.get(c.to)! + 1);
  }
  const order: number[] = [];
  const ready = hidden.filter((n) => pending.get(n.id) === 0).map((n) => n.id);
  while (ready.length > 0) {
    ready.sort((a, b) => a - b);
    const id = ready.shift()!;
    order.push(id);
    for (const c of connections) {
      if (c.from !== id || !pending.has(c.to)) continue;
      const left = pending.get(c.to)! - 1;
      pending.set(c.to, left);
      if (left === 0) ready.push(c.to);
    }
  }
  // Cycles through outputs or inputs are impossible: outputs have no outgoing connections and
  // inputs no incoming ones (validated), so a cycle can only run through hidden nodes.
  return order.length === hidden.length ? order : null;
}

/** A NEAT genome ready to run: per node in evaluation order, its incoming enabled connections. */
export interface CompiledNeat {
  readonly inputs: number;
  readonly outputs: number;
  /** Hidden nodes; their values sit after the inputs and outputs, in genome order. */
  readonly hiddenCount: number;
  /** Evaluation steps: hidden nodes in order, then the outputs. */
  readonly steps: readonly {
    readonly slot: number;
    readonly hidden: boolean;
    readonly sources: Int32Array;
    readonly weights: Float64Array;
  }[];
}

const compiled = new WeakMap<Float32Array, CompiledNeat>();

/** Validates and compiles `genome` (cached per genome array: genomes are never changed in place). */
export function compileNeat(spec: BrainSpec, genome: Float32Array): CompiledNeat {
  const known = compiled.get(genome);
  if (known !== undefined && known.inputs === spec.inputs && known.outputs === spec.outputs) {
    return known;
  }
  validateNeatGenome(spec, genome);
  const { hidden, connections } = decodeNeat(genome);
  const slotOf = new Map<number, number>();
  for (let i = 0; i < spec.inputs + spec.outputs; i++) slotOf.set(i, i);
  hidden.forEach((n, k) => slotOf.set(n.id, spec.inputs + spec.outputs + k));
  const step = (id: number, isHidden: boolean) => {
    // Connections are sorted by (from, to): sources sum in ascending id order on every engine.
    const incoming = connections.filter((c) => c.enabled && c.to === id);
    return {
      slot: slotOf.get(id)!,
      hidden: isHidden,
      sources: Int32Array.from(incoming, (c) => slotOf.get(c.from)!),
      weights: Float64Array.from(incoming, (c) => c.weight),
    };
  };
  const steps = [
    ...hiddenOrder(hidden, connections)!.map((id) => step(id, true)),
    ...Array.from({ length: spec.outputs }, (_, o) => step(spec.inputs + o, false)),
  ];
  const result: CompiledNeat = {
    inputs: spec.inputs,
    outputs: spec.outputs,
    hiddenCount: hidden.length,
    steps,
  };
  compiled.set(genome, result);
  return result;
}

/** Scratch space for `neatForward`, sized for a spec. */
export function createNeatScratch(spec: BrainSpec): Float64Array {
  return new Float64Array(spec.inputs + spec.outputs + spec.hidden);
}

/**
 * Runs a compiled genome: writes the outputs (linear) to `outputs` and returns it. Hidden values
 * stay in `values` (slots after the outputs, genome order) for the inspector. Float64 sums in a
 * fixed order, like the MLP's forward pass (plan §3.3).
 */
export function neatForward(
  net: CompiledNeat,
  inputs: ArrayLike<number>,
  values: Float64Array,
  outputs: Float64Array,
): Float64Array {
  for (let i = 0; i < net.inputs; i++) values[i] = inputs[i]!;
  for (const s of net.steps) {
    let sum = 0;
    for (let k = 0; k < s.sources.length; k++) sum += s.weights[k]! * values[s.sources[k]!]!;
    values[s.slot] = s.hidden ? softsign(sum) : sum;
  }
  for (let o = 0; o < net.outputs; o++) outputs[o] = values[net.inputs + o]!;
  return outputs;
}

/** Generation 1: every input connected to every output, uniform weights in ±range. */
export function randomNeatGenome(spec: BrainSpec, rng: RngStream, range: number): Float32Array {
  const connections: NeatConnection[] = [];
  for (let i = 0; i < spec.inputs; i++) {
    for (let o = 0; o < spec.outputs; o++) {
      connections.push({
        from: i,
        to: spec.inputs + o,
        weight: range > 0 ? rng.nextRange(-range, range) : 0,
        enabled: true,
      });
    }
  }
  return encodeNeat({ hidden: [], connections });
}

/**
 * Hidden node ids of a run (historical markings): the node that splits connection a→b has the
 * same id in every genome. Built from the genomes alive at breeding (members and halls of fame),
 * so it needs no saved state; a split not seen among them gets the next free id.
 */
export class NeatRegistry {
  private readonly bySplit = new Map<number, number>();
  private nextId: number;

  constructor(spec: BrainSpec, genomes: readonly Float32Array[]) {
    let next = firstHiddenId(spec);
    for (const g of genomes) {
      for (const n of decodeNeat(g).hidden) {
        const key = n.splitFrom * MAX_NODE_ID + n.splitTo;
        if (!this.bySplit.has(key)) this.bySplit.set(key, n.id);
        next = Math.max(next, n.id + 1);
      }
    }
    this.nextId = next;
  }

  idFor(from: number, to: number): number {
    const key = from * MAX_NODE_ID + to;
    const known = this.bySplit.get(key);
    if (known !== undefined) return known;
    const id = this.nextId++;
    this.bySplit.set(key, id);
    return id;
  }
}

/**
 * Child of `fitter` and `other`: the fitter parent's structure; each connection both have takes
 * its weight and on/off state from either parent (one coin per matching connection).
 */
export function crossoverNeat(
  fitter: Float32Array,
  other: Float32Array,
  rng: RngStream,
): Float32Array {
  const a = decodeNeat(fitter);
  const byKey = new Map<string, NeatConnection>();
  for (const c of decodeNeat(other).connections) byKey.set(`${c.from}:${c.to}`, c);
  const connections = a.connections.map((c) => {
    const match = byKey.get(`${c.from}:${c.to}`);
    const from = match !== undefined && rng.nextUint32() & 1 ? match : c;
    return { from: c.from, to: c.to, weight: from.weight, enabled: from.enabled };
  });
  return encodeNeat({ hidden: a.hidden, connections });
}

/** True if `to` can reach `from` through any connection: adding from→to would close a cycle. */
function reaches(connections: readonly NeatConnection[], start: number, target: number): boolean {
  const stack = [start];
  const seen = new Set<number>([start]);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === target) return true;
    for (const c of connections) {
      if (c.from === id && !seen.has(c.to)) {
        seen.add(c.to);
        stack.push(c.to);
      }
    }
  }
  return false;
}

/**
 * A mutated copy of `genome`, in a fixed draw order: per connection a weight coin (then noise) and
 * a toggle coin; then one add-connection coin (then the two nodes, then the weight if the
 * connection is new and feed-forward); then one add-node coin (then the connection to split).
 * Weights end clamped to ±clamp.
 */
export function mutateNeat(
  spec: BrainSpec,
  genome: Float32Array,
  rng: RngStream,
  m: NeatMutation,
  registry: NeatRegistry,
  gaussian: (rng: RngStream) => number,
): Float32Array {
  const { hidden, connections } = decodeNeat(genome);
  for (const c of connections) {
    let w = c.weight;
    if (rng.nextFloat() < m.rate) w += gaussian(rng) * m.sigma;
    c.weight = Math.max(-m.clamp, Math.min(m.clamp, w));
    if (rng.nextFloat() < m.neat.toggleRate) c.enabled = !c.enabled;
  }

  if (rng.nextFloat() < m.neat.addConnectionRate && connections.length < m.neat.maxConnections) {
    const hiddenIds = hidden.map((n) => n.id);
    const sources = [...Array.from({ length: spec.inputs }, (_, i) => i), ...hiddenIds];
    const targets = [
      ...hiddenIds,
      ...Array.from({ length: spec.outputs }, (_, o) => spec.inputs + o),
    ];
    const from = sources[rng.nextInt(0, sources.length)]!;
    const to = targets[rng.nextInt(0, targets.length)]!;
    const exists = connections.some((c) => c.from === from && c.to === to);
    if (from !== to && !exists && !reaches(connections, to, from)) {
      const range = m.initialWeightRange;
      connections.push({
        from,
        to,
        weight: range > 0 ? rng.nextRange(-range, range) : 0,
        enabled: true,
      });
    }
  }

  if (
    rng.nextFloat() < m.neat.addNodeRate &&
    hidden.length < Math.min(spec.hidden, m.neat.maxHiddenNodes) &&
    connections.length + 2 <= m.neat.maxConnections
  ) {
    const enabled = connections.filter((c) => c.enabled);
    if (enabled.length > 0) {
      const split = enabled[rng.nextInt(0, enabled.length)]!;
      const id = registry.idFor(split.from, split.to);
      if (!hidden.some((n) => n.id === id)) {
        split.enabled = false;
        hidden.push({ id, splitFrom: split.from, splitTo: split.to });
        connections.push({ from: split.from, to: id, weight: 1, enabled: true });
        connections.push({ from: id, to: split.to, weight: split.weight, enabled: true });
      }
    }
  }

  hidden.sort((a, b) => a.id - b.id);
  connections.sort(compareConnections);
  return encodeNeat({ hidden, connections });
}
