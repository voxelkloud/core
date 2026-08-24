/**
 * One node of a level-of-detail tree, reduced to what a scheduler reads.
 *
 * NEUTRAL: nothing here says where the node's points live. A Potree node also
 * carries a byte range into `octree.bin`, a COPC node an offset into the single
 * LAZ file, a 3D Tiles node a content URI — that is the driver's business and
 * the scheduler never sees it.
 */
export interface PointCloudNode {
  /** Dense, stable, and the key for every side array. */
  readonly index: number;
  /**
   * The format's own name for this node: `"r0402"`, `"2-1-0-1"`.
   *
   * Not derivable from `index`, which is an artefact of materialisation order,
   * and it is what a decoder puts on its output, an error puts in `path`, and a
   * cache keys on — so it belongs on the node rather than being reconstructed
   * by whoever needs it.
   */
  readonly name: string;
  /** Root is 0. */
  readonly level: number;
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  /** THIS NODE'S OWN LAYER, never a subtree total. */
  readonly numPoints: number;
  /**
   * TRI-STATE, and only the first two states are read by the scheduler:
   * `undefined` while the children are not yet known, `0` for a leaf, and
   * anything else for "has children — walk `children`".
   *
   * On an octree it is also octant occupancy, a bit per slot, which is what
   * every driver here writes. A format whose nodes are not octants (a tileset
   * tile has any number of children, in no particular arrangement) sets it to a
   * non-zero count and leaves the bit meaning behind.
   */
  readonly childMask: number | undefined;
  /**
   * Length 8 on an octree. ANY length elsewhere: the scheduler walks
   * `children.length` and never assumes eight.
   */
  readonly children: readonly (PointCloudNode | undefined)[];
  readonly parent: PointCloudNode | undefined;
}

/**
 * The tree contract the LOD scheduler is written against.
 *
 * `@voxelkloud/view/lod` declares this shape STRUCTURALLY rather than importing
 * it, which is what keeps its module graph at zero dependencies; this
 * declaration is the same contract stated once so drivers have something to
 * implement against and to be typechecked by.
 *
 * On the split between `geometricErrorAt` and `pointSpacingAt`, and on when the
 * per-node arrays are worth filling, see the doc comments on each member.
 */
export interface PointCloudTreeBase {
  /** Nodes materialised so far. MONOTONIC, and the bound on `node.index`. */
  readonly nodeCount: number;
  readonly root: PointCloudNode;
  /** Highest level materialised so far. */
  readonly maxLevel: number;
  node(index: number): PointCloudNode | undefined;

  /**
   * THE REFINEMENT QUANTITY, world units: how much detail is lost by NOT
   * descending past `level`. For a point octree this is the inter-point
   * spacing; for a tile format it is the tile's geometric error.
   */
  geometricErrorAt(level: number): number;
  /**
   * THE POINT PITCH, world units. Sizes points and places the near plane, and
   * is NEVER the refinement key — the two coincide on octrees and diverge
   * everywhere else.
   */
  pointSpacingAt(level: number): number;
  boundingRadiusAt(level: number): number;

  /**
   * Dense per-node overrides indexed by `node.index`, for formats whose LOD
   * quantities are not a closed form of the level. `undefined` on every octree.
   * A driver that fills `nodeGeometricError` owes monotonicity
   * (`error[child] <= error[parent]`), clamped at expansion time and reported
   * through warnings — the scheduler assumes it and does not re-check.
   */
  readonly nodeGeometricError?: Float64Array | undefined;
  readonly nodePointSpacing?: Float64Array | undefined;
  readonly nodeBoundingRadius?: Float64Array | undefined;
  /**
   * THIS NODE'S OWN LAYER, overriding {@link PointCloudNode.numPoints}, for a
   * format that does not declare a count until the payload arrives.
   *
   * A `tileset.json` declares none: the count lives in the `.pnts` feature
   * table or the glTF accessor, both of which cost the whole tile. So the
   * driver seeds a nominal — never 0, or the node is never even fetched — and
   * writes the true count here once it has decoded one. Nodes are frozen at
   * expansion, which is exactly why the correction is a side array and not a
   * mutation.
   *
   * `undefined` on every format that declares its counts up front.
   */
  readonly nodePointCount?: Float64Array | undefined;
  /**
   * 1 where this node's children REPLACE it rather than adding to it.
   *
   * Read by the renderer, NEVER by the scheduler: deciding it needs to know
   * which children are resident on the GPU, and dropping a parent before they
   * are opens a hole exactly where the picture was about to improve. Per node
   * rather than per tree because 3D Tiles lets `refine` change partway down.
   */
  readonly nodeReplaces?: Uint8Array | undefined;
  /** Format-native default for `targetScreenError`, device px. */
  readonly defaultScreenError?: number | undefined;

  /**
   * Materialise one node's children, fetching if needed. Resolves to the node
   * itself, now expanded. Cancellable and deduped.
   */
  expand(
    node: PointCloudNode,
    options?: { readonly signal?: AbortSignal },
  ): Promise<PointCloudNode>;
  /**
   * Materialise the whole tree. Lifecycle, not traversal: a caller that would
   * rather pay one up-front cost than stream the hierarchy calls this once.
   */
  expandAll(options?: { readonly signal?: AbortSignal }): Promise<void>;
  /** Release buffers and abort in-flight requests. Idempotent. */
  dispose(): void;

  /** SYNCHRONOUS, never throws, safe from a render loop. */
  tryExpandSync(node: PointCloudNode): boolean;
  /** Fire-and-forget. A documented no-op inside a backoff window. */
  requestExpand(node: PointCloudNode, signal?: AbortSignal): void;
}
