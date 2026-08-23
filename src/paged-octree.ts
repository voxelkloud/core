// One octree, three formats.
//
// Potree v2, COPC and EPT all index space the same way — a cube halved on all
// three axes, a node per occupied octant — and all three deliver the hierarchy
// the same way too: in PAGES, where a page lists some nodes and, for subtrees
// it did not fit, a REFERENCE to another page. Potree calls those references
// proxy nodes, COPC gives them a point count of -1, EPT gives them a count of
// -1 in a JSON object. Same idea, three spellings.
//
// So the engine is here and the spelling is the driver's. A driver supplies a
// root cube, a root page reference, and a `loadPage` that turns one reference
// into entries; everything below — node identity, bounds, child wiring, dedupe,
// backoff, the synchronous path the render loop needs — is shared.
//
// It does NO I/O of its own. `loadPage` is the only way bytes enter, which is
// what keeps this package free of transport policy while still owning the
// structure that three drivers would otherwise each get subtly wrong.

import { VoxelkloudError, isVoxelkloudError } from "./errors.js";
import type { BoundingBox } from "./metadata.js";
import type { ChildIndex } from "./octree-math.js";
import type { PointCloudNode, PointCloudTreeBase } from "./tree.js";
import type { PointCloudWarning } from "./warnings.js";

const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_NODES = 8_000_000;
const DEFAULT_MAX_CONCURRENT = 8;
const DEFAULT_MAX_ATTEMPTS = 3;

const defaultRetryDelayMs = (attempt: number): number =>
  Math.min(250 * 2 ** (attempt - 1), 10_000);

/**
 * The anomalies this engine tolerates. A CLOSED union: a driver that surfaces
 * these alongside its own can discriminate on the code.
 */
export type PagedOctreeWarningCode =
  | "hierarchy-depth-exceeded"
  | "hierarchy-key-out-of-range"
  | "hierarchy-node-limit"
  | "hierarchy-late-child";

export type PagedOctreeWarning = PointCloudWarning<PagedOctreeWarningCode>;

/**
 * A node's address in the octree: its level and its integer cell on each axis.
 *
 * ABSOLUTE, not a path, because that is how both formats that use this engine
 * write it down — COPC's 4-int hierarchy key and EPT's `"D-X-Y-Z"` filename are
 * the same three numbers. At level L each axis runs `0 .. 2^L - 1`.
 */
export interface OctreeKey {
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One node a page declares, with the driver's own handle for its points. */
export interface OctreePageNode<P> extends OctreeKey {
  /** THIS NODE'S OWN LAYER, never a subtree total. */
  readonly pointCount: number;
  /** Opaque here; the driver reads it back when the node's points are wanted. */
  readonly payload: P;
}

/** A subtree this page did not contain, and where the rest of it lives. */
export interface OctreePageLink<R> extends OctreeKey {
  readonly ref: R;
}

/** What {@link PagedOctreeOptions.loadPage} resolves to. */
export interface OctreePage<P, R> {
  readonly nodes: readonly OctreePageNode<P>[];
  readonly links: readonly OctreePageLink<R>[];
}

export interface PagedOctreeNode<P = unknown> extends PointCloudNode {
  readonly level: number;
  /** Integer cell on each axis at this level. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** `"3-1-0-2"` — level and cell, the spelling both formats use in filenames. */
  readonly key: string;
  /**
   * The driver's handle for this node's points, or `undefined` when the node is
   * a placeholder for a page not yet fetched.
   *
   * A placeholder exists because a page said "the subtree at this key continues
   * elsewhere" and the engine will not pretend the node is absent — a scheduler
   * has to be able to ask for it. Until that page lands the node reports zero
   * points and an unknown child mask, which is exactly what makes the scheduler
   * request the expansion that fills it in.
   */
  readonly payload: P | undefined;
  readonly children: readonly (PagedOctreeNode<P> | undefined)[];
  readonly parent: PagedOctreeNode<P> | undefined;
}

export interface PagedOctreeOptions<P, R> {
  /**
   * The CUBE the octree subdivides, in absolute CRS units. Node bounds are
   * derived from it by halving, never recomputed from the key, so a node and
   * its parent agree to the last bit.
   */
  readonly bounds: BoundingBox;
  /** The page that describes the root. */
  readonly rootPage: R;
  /** Turn one page reference into its entries. The ONLY way bytes enter. */
  loadPage(ref: R, signal: AbortSignal): Promise<OctreePage<P, R>>;
  /** World-unit refinement quantity at a level. See `PointCloudTreeBase`. */
  geometricErrorAt(level: number): number;
  /** World-unit point pitch at a level. See `PointCloudTreeBase`. */
  pointSpacingAt(level: number): number;
  /** Format-native default for `targetScreenError`, device px. */
  readonly defaultScreenError?: number | undefined;
  /** Refuse to descend past this. Default 32. */
  readonly maxDepth?: number;
  /** Refuse to materialise more than this many nodes. Default 8,000,000. */
  readonly maxNodes?: number;
  /** Concurrent page requests. Default 8. */
  readonly maxConcurrentPageRequests?: number;
  /** Attempts per page before a node's failure becomes permanent. Default 3. */
  readonly maxAttempts?: number;
  readonly retryDelayMs?: (attempt: number) => number;
  /** Injectable clock, for tests over the backoff window. */
  readonly now?: () => number;
}

export interface PagedOctree<P = unknown> extends PointCloudTreeBase {
  readonly root: PagedOctreeNode<P>;
  node(index: number): PagedOctreeNode<P> | undefined;
  /** By `"level-x-y-z"`, the spelling in {@link PagedOctreeNode.key}. */
  nodeByKey(key: string): PagedOctreeNode<P> | undefined;
  /** Tolerated anomalies, at most one per distinct code. */
  readonly warnings: readonly PagedOctreeWarning[];
  /** Pages fetched, and pages still in flight. */
  readonly stats: { readonly pagesLoaded: number; readonly pending: number };
}

/**
 * The single frozen all-undefined tuple shared by every childless node — 80% of
 * a real octree's — and by every node not yet expanded. Identity is meaningful:
 * a node still holding it has never had a child written.
 */
const EMPTY_CHILDREN = Object.freeze([
  undefined, undefined, undefined, undefined,
  undefined, undefined, undefined, undefined,
]) as readonly undefined[];

type NodeState = "unexpanded" | "expanding" | "expanded" | "failed";

class Node<P> implements PagedOctreeNode<P> {
  children: readonly (Node<P> | undefined)[] = EMPTY_CHILDREN;
  childMask: number | undefined = undefined;
  numPoints = 0;
  payload: P | undefined = undefined;
  /** The page that describes THIS node's children, when it is not this one. */
  page: unknown = undefined;
  state: NodeState = "unexpanded";
  failure: { error: VoxelkloudError; retryAfter: number | undefined } | undefined;
  attempts = 0;

  constructor(
    readonly index: number,
    readonly level: number,
    readonly x: number,
    readonly y: number,
    readonly z: number,
    readonly parent: Node<P> | undefined,
    readonly minX: number,
    readonly minY: number,
    readonly minZ: number,
    readonly maxX: number,
    readonly maxY: number,
    readonly maxZ: number,
  ) {}

  get key(): string {
    return `${this.level}-${this.x}-${this.y}-${this.z}`;
  }
  /** What a decoder wants: the flat, acyclic subset. */
  get name(): string {
    return this.key;
  }
}

/**
 * Which octant of its parent a cell falls in.
 *
 * Bit 0 is Z, bit 1 is Y, bit 2 is X — core's `childBoundingBox` convention,
 * pinned to Potree's `createChildAABB`. Both COPC and EPT number their cells
 * along the same axes, so the low bit of each coordinate IS the octant.
 */
function octantOf(x: number, y: number, z: number): ChildIndex {
  return (((x & 1) << 2) | ((y & 1) << 1) | (z & 1)) as ChildIndex;
}

/**
 * Halve the parent's box along the octant bits.
 *
 * Written in exactly core's `childBoundingBox` form (`lo += size/2` /
 * `hi -= size/2`, never `(lo+hi)/2`) so the two are bit-identical, and fused
 * here so the page loop does not allocate a `BoundingBox` per node. Derived by
 * halving rather than computed from the key: `min + x * size / 2^level`
 * disagrees with the parent in the last ulp at depth, and a child that pokes
 * out of its parent is a culling bug that only shows on deep trees.
 */
function makeChild<P>(
  parent: Node<P>,
  index: number,
  x: number,
  y: number,
  z: number,
): Node<P> {
  const octant = octantOf(x, y, z);
  const sizeX = parent.maxX - parent.minX;
  const sizeY = parent.maxY - parent.minY;
  const sizeZ = parent.maxZ - parent.minZ;

  let minX = parent.minX;
  let maxX = parent.maxX;
  let minY = parent.minY;
  let maxY = parent.maxY;
  let minZ = parent.minZ;
  let maxZ = parent.maxZ;

  if (octant & 0b001) minZ += sizeZ / 2;
  else maxZ -= sizeZ / 2;
  if (octant & 0b010) minY += sizeY / 2;
  else maxY -= sizeY / 2;
  if (octant & 0b100) minX += sizeX / 2;
  else maxX -= sizeX / 2;

  return new Node<P>(
    index,
    parent.level + 1,
    x,
    y,
    z,
    parent,
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
  );
}

interface InFlight<P, R> {
  readonly controller: AbortController;
  readonly promise: Promise<OctreePage<P, R>>;
  refs: number;
  queued: boolean;
  start?: () => void;
}

class Tree<P, R> implements PagedOctree<P> {
  readonly root: Node<P>;
  readonly warnings: PagedOctreeWarning[] = [];
  maxLevel = 0;

  private readonly nodeList: Node<P>[];
  private readonly byKey = new Map<string, Node<P>>();
  private readonly emitted = new Set<PagedOctreeWarningCode>();
  private readonly inFlight = new Map<unknown, InFlight<P, R>>();
  private readonly queue: InFlight<P, R>[] = [];
  private active = 0;
  private pagesLoaded = 0;
  private disposed = false;
  private readonly halfDiagonal: number;

  constructor(private readonly options: PagedOctreeOptions<P, R>) {
    const { min, max } = options.bounds;
    this.root = new Node<P>(
      0, 0, 0, 0, 0, undefined,
      min[0]!, min[1]!, min[2]!,
      max[0]!, max[1]!, max[2]!,
    );
    this.root.page = options.rootPage;
    this.nodeList = [this.root];
    this.byKey.set(this.root.key, this.root);
    this.halfDiagonal =
      0.5 *
      Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
  }

  // ── synchronous view ────────────────────────────────────────────────────

  get nodeCount(): number {
    return this.nodeList.length;
  }
  get stats(): { pagesLoaded: number; pending: number } {
    return { pagesLoaded: this.pagesLoaded, pending: this.inFlight.size };
  }
  get defaultScreenError(): number | undefined {
    return this.options.defaultScreenError;
  }

  node(index: number): Node<P> | undefined {
    return this.nodeList[index];
  }
  nodeByKey(key: string): Node<P> | undefined {
    return this.byKey.get(key);
  }

  geometricErrorAt(level: number): number {
    return this.options.geometricErrorAt(level);
  }
  pointSpacingAt(level: number): number {
    return this.options.pointSpacingAt(level);
  }
  boundingRadiusAt(level: number): number {
    return this.halfDiagonal / 2 ** level;
  }

  private warn(
    code: PagedOctreeWarningCode,
    path: string,
    message: string,
  ): void {
    // At most once per code: a corrupt file with 400k bad entries would
    // otherwise allocate 400k warning objects. A warning is a signal, not an
    // inventory.
    if (this.emitted.has(code)) return;
    this.emitted.add(code);
    this.warnings.push({ code, path, message });
  }

  // ── page application ────────────────────────────────────────────────────

  /**
   * Find or create the node at a key, materialising the chain down to it.
   *
   * Pages are not required to list a parent before a child, and COPC's do not
   * in general, so this walks from the deepest existing ancestor. Returns
   * `undefined` when the key is out of range or the tree is at its cap, having
   * warned.
   */
  private ensureNode(k: OctreeKey): Node<P> | undefined {
    if (k.level < 0 || k.level > this.maxDepth) {
      this.warn(
        "hierarchy-depth-exceeded",
        keyOf(k),
        `Hierarchy declares a node at level ${k.level}; the tree stops at ` +
          `${this.maxDepth}. Deeper nodes are ignored.`,
      );
      return undefined;
    }
    const span = 2 ** k.level;
    if (
      !Number.isInteger(k.x) || !Number.isInteger(k.y) || !Number.isInteger(k.z) ||
      k.x < 0 || k.y < 0 || k.z < 0 ||
      k.x >= span || k.y >= span || k.z >= span
    ) {
      this.warn(
        "hierarchy-key-out-of-range",
        keyOf(k),
        `Hierarchy declares a cell outside the 0..${span - 1} range its own ` +
          `level allows. Ignored.`,
      );
      return undefined;
    }

    const existing = this.byKey.get(keyOf(k));
    if (existing !== undefined) return existing;
    if (k.level === 0) return this.root;

    const parent = this.ensureNode({
      level: k.level - 1,
      x: k.x >> 1,
      y: k.y >> 1,
      z: k.z >> 1,
    });
    if (parent === undefined) return undefined;
    if (this.nodeList.length >= this.maxNodes) {
      this.warn(
        "hierarchy-node-limit",
        keyOf(k),
        `Hierarchy exceeds maxNodes (${this.maxNodes}). The rest is ignored.`,
      );
      return undefined;
    }

    const child = makeChild<P>(parent, this.nodeList.length, k.x, k.y, k.z);
    this.nodeList.push(child);
    this.byKey.set(child.key, child);
    if (child.level > this.maxLevel) this.maxLevel = child.level;

    if (parent.state === "expanded") {
      // A page settled this parent and a later page has now put a child under
      // it. Wiring it anyway is the tolerant answer — the scheduler re-reads
      // `childMask` every frame and will descend on the next one — but it means
      // the two pages disagree, which is worth saying once.
      this.warn(
        "hierarchy-late-child",
        child.key,
        `A hierarchy page declared a child of ${parent.key} after another page ` +
          `had already settled its children. Both are kept.`,
      );
    }
    if (parent.children === EMPTY_CHILDREN) {
      parent.children = [
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
      ];
    }
    const octant = octantOf(k.x, k.y, k.z);
    (parent.children as (Node<P> | undefined)[])[octant] = child;
    parent.childMask = (parent.childMask ?? 0) | (1 << octant);
    return child;
  }

  private get maxDepth(): number {
    return this.options.maxDepth ?? DEFAULT_MAX_DEPTH;
  }
  private get maxNodes(): number {
    return this.options.maxNodes ?? DEFAULT_MAX_NODES;
  }

  /**
   * Fold one page into the tree.
   *
   * `owner` is the node whose page this was. Every node the page declares gets
   * its payload and count; every link becomes a placeholder that will expand
   * when its own page arrives. Nodes touched by the page and NOT carrying a
   * link of their own are settled: their children are whatever this page said,
   * including none.
   */
  private applyPage(owner: Node<P>, page: OctreePage<P, R>): void {
    const touched: Node<P>[] = [];

    for (const entry of page.nodes) {
      const node = this.ensureNode(entry);
      if (node === undefined) continue;
      node.numPoints = entry.pointCount;
      node.payload = entry.payload;
      touched.push(node);
    }
    for (const link of page.links) {
      const node = this.ensureNode(link);
      if (node === undefined) continue;
      // A link makes this node the owner of ANOTHER page, so it is not settled
      // by this one — it goes back to unexpanded with somewhere to go.
      node.page = link.ref;
      node.state = "unexpanded";
      node.failure = undefined;
      node.childMask = undefined;
    }

    // Settle after both loops: a page may declare a node and then link its
    // subtree, and the link has to win.
    for (const node of touched) {
      if (node.page !== undefined && node !== owner) continue;
      if (node.state === "expanded") continue;
      this.settle(node);
    }
    // The owner is settled even when the page never mentioned it — an empty
    // page means "this subtree is a leaf", not "ask again".
    if (owner.state !== "expanded") this.settle(owner);
  }

  /**
   * Mark a node's children final.
   *
   * The child array is deliberately NOT frozen. Potree freezes because its
   * whole hierarchy is one buffer and a node's children are known once and for
   * all; here a malformed file can put a child under an already-settled parent,
   * and a frozen array turns that into a `TypeError` out of the page loop
   * instead of the warning it deserves.
   */
  private settle(node: Node<P>): void {
    node.childMask ??= 0;
    node.state = "expanded";
    node.failure = undefined;
  }

  // ── expansion ───────────────────────────────────────────────────────────

  private ours(node: PointCloudNode): node is Node<P> {
    return node instanceof Node && this.nodeList[node.index] === node;
  }

  private retryDue(node: Node<P>): boolean {
    const f = node.failure;
    if (f === undefined) return true;
    if (f.retryAfter === undefined) return false;
    return (this.options.now ?? Date.now)() >= f.retryAfter;
  }

  private recordFailure(node: Node<P>, error: unknown, permanent: boolean): void {
    const err = isVoxelkloudError(error)
      ? error
      : new VoxelkloudError("hierarchy-error", String(error), { cause: error });
    node.attempts++;
    const exhausted =
      permanent || node.attempts >= (this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    node.state = "failed";
    node.failure = {
      error: err,
      retryAfter: exhausted
        ? undefined
        : (this.options.now ?? Date.now)() +
          (this.options.retryDelayMs ?? defaultRetryDelayMs)(node.attempts),
    };
  }

  /**
   * SYNCHRONOUS, never throws, safe from a render loop.
   *
   * True only when the node is already settled. Nothing here can fetch, and a
   * paged hierarchy always can need to — unlike Potree, whose whole
   * `hierarchy.bin` is commonly resident, so its equivalent usually succeeds.
   */
  tryExpandSync(node: PointCloudNode): boolean {
    return node.childMask !== undefined;
  }

  async expand(
    node: PointCloudNode,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<PointCloudNode> {
    if (node.childMask !== undefined) return node;
    if (!this.ours(node)) {
      throw new VoxelkloudError(
        "hierarchy-error",
        `Node ${String((node as Node<P>).key ?? node.index)} does not belong ` +
          `to this hierarchy.`,
      );
    }
    if (node.state === "failed") {
      if (!this.retryDue(node)) throw node.failure!.error;
      node.state = "unexpanded";
    }
    const ref = node.page as R | undefined;
    if (ref === undefined) {
      // Nothing said this node's children live anywhere. That is a leaf whose
      // page simply had no entries under it, and a caller that keeps asking
      // would spin — so settle it here rather than reporting a failure.
      this.settle(node);
      return node;
    }

    let entry = this.inFlight.get(ref);
    if (entry === undefined) {
      entry = this.startPage(ref);
      this.inFlight.set(ref, entry);
    } else {
      entry.refs++;
    }
    node.state = "expanding";

    const onAbort = () => {
      if (--entry!.refs <= 0) entry!.controller.abort();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const page = await entry.promise;
      if (this.disposed) return node;
      this.applyPage(node, page);
      return node;
    } catch (error) {
      if (isAbort(error)) throw error;
      this.recordFailure(node, error, false);
      throw node.failure!.error;
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      this.inFlight.delete(ref);
    }
  }

  private startPage(ref: R): InFlight<P, R> {
    const controller = new AbortController();
    const entry: InFlight<P, R> = {
      controller,
      refs: 1,
      queued: true,
      promise: undefined as unknown as Promise<OctreePage<P, R>>,
    };
    const max = this.options.maxConcurrentPageRequests ?? DEFAULT_MAX_CONCURRENT;
    (entry as { promise: Promise<OctreePage<P, R>> }).promise = new Promise<
      OctreePage<P, R>
    >((resolve, reject) => {
      const run = () => {
        entry.queued = false;
        this.active++;
        this.options
          .loadPage(ref, controller.signal)
          .then((page) => {
            this.pagesLoaded++;
            resolve(page);
          }, reject)
          .finally(() => {
            this.active--;
            this.pump();
          });
      };
      entry.start = run;
      if (this.active < max) run();
      else this.queue.push(entry);
    });
    return entry;
  }

  private pump(): void {
    const max = this.options.maxConcurrentPageRequests ?? DEFAULT_MAX_CONCURRENT;
    while (this.active < max && this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (!next.queued) continue;
      next.start?.();
    }
  }

  /**
   * Fire-and-forget. A documented no-op inside the backoff window, so a render
   * loop that asks every frame does not become a request storm.
   */
  requestExpand(node: PointCloudNode, signal?: AbortSignal): void {
    if (node.childMask !== undefined) return;
    if (!this.ours(node)) return;
    if (node.state === "expanding") return;
    if (node.state === "failed" && !this.retryDue(node)) return;
    void this.expand(node, signal === undefined ? {} : { signal }).catch(
      () => {
        // Already recorded on the node; a rejection here has no caller.
      },
    );
  }

  async expandAll(options: { readonly signal?: AbortSignal } = {}): Promise<void> {
    // Breadth-first over whatever is unexpanded, re-scanning after each wave:
    // a page can introduce links at any depth, so there is no single pass that
    // is guaranteed to be the last one.
    for (;;) {
      const pending = this.nodeList.filter(
        (n) => n.childMask === undefined && n.page !== undefined,
      );
      if (pending.length === 0) return;
      const results = await Promise.allSettled(
        pending.map((n) =>
          this.expand(n, options.signal === undefined ? {} : { signal: options.signal }),
        ),
      );
      // Every node failing means no progress is possible; without this the loop
      // would re-select the same nodes for ever.
      if (results.every((r) => r.status === "rejected")) {
        const first = results.find((r) => r.status === "rejected");
        throw (first as PromiseRejectedResult).reason;
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.inFlight.values()) entry.controller.abort();
    this.inFlight.clear();
    this.queue.length = 0;
  }
}

function keyOf(k: OctreeKey): string {
  return `${k.level}-${k.x}-${k.y}-${k.z}`;
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Build a lazily-paged octree over a driver's `loadPage`.
 *
 * The root is materialised immediately and is UNEXPANDED: nothing is fetched
 * until `expand`, `requestExpand` or `expandAll` asks for it. Most callers
 * `await tree.expand(tree.root)` once so the first frame has something to draw.
 */
export function createPagedOctree<P, R>(
  options: PagedOctreeOptions<P, R>,
): PagedOctree<P> {
  return new Tree<P, R>(options);
}
