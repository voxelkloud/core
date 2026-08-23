// The node payload, stated once for every driver.
//
// These types were Potree's until the COPC driver arrived and showed which of
// them were about a FORMAT and which were about a POINT. Everything here is the
// second kind: a decoded node is `numPoints` positions in a stated frame, an
// optional colour, and named attributes — as true of a LAS point record or a
// raw EPT block as of a Potree one. What stays in a driver is the arithmetic
// that produces them.
//
// Everything except `ReadPointsOptions.signal` and
// `OpenPointsOptions.decompress` is structured-cloneable. That is the invariant
// that keeps a future worker a drop-in rather than a redesign.

import type { AttributeRole, PointAttribute } from "./attributes.js";
import type { BoundingBox, PointAttributeTypeName, Vec3 } from "./metadata.js";
import type { PointCloudNode } from "./tree.js";

/**
 * Everything a decoder needs about a node, and nothing more.
 *
 * A {@link PointCloudNode} satisfies this STRUCTURALLY, so no extraction step
 * is needed — but a tree node is cyclic via `parent` and cannot cross a worker
 * boundary (structured clone would deep-copy all 4377 autzen nodes per
 * message), so the decode path is typed against this flat subset.
 *
 * `byteOffset`/`byteSize` are how a SINGLE-FILE format addresses a node —
 * Potree's range into `octree.bin`, COPC's into the `.laz`. A format that puts
 * one file per node leaves both `undefined` and addresses it another way;
 * nothing downstream of the driver reads them.
 *
 * `minX..maxZ` are in ABSOLUTE CRS UNITS.
 */
export interface PointNodeRef {
  /** The tree's dense, stable index. The only correlation key back to it. */
  readonly index: number;
  /** `"r0402"`, `"2-1-0-1"`. Diagnostics, error `path`, cache keys. */
  readonly name: string;
  /** Authoritative. Never inferred from a byte length. */
  readonly numPoints: number;
  /**
   * Optional, and absent rather than `undefined` when the format does not
   * address nodes by byte range at all — which is what lets a
   * {@link PointCloudNode} be passed straight to {@link PointReader.read}.
   */
  readonly byteOffset?: number | undefined;
  readonly byteSize?: number | undefined;
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/**
 * - `"float32"` (default) — `Float32Array`, `3 * numPoints`, CRS units relative
 *   to {@link PointPositionFrame.origin}. `frame.scale` is `[1,1,1]`.
 * - `"int32"` — `Int32Array`, the stored quantized integers verbatim. Exactly
 *   lossless. `frame.scale` is the file's quantization scale.
 */
export type PositionFormat = "float32" | "int32";

/**
 * Which point {@link PointPositionFrame.origin} is.
 *
 * - `"cloud"` (default) — the cloud's indexing box min. The SAME triple for every
 *   node, so one model matrix serves the whole cloud and node buffers stay
 *   concatenable into a shared vertex buffer.
 * - `"node"` — this node's box min. Buys one mantissa bit per level (measured
 *   identical to `"cloud"` at the root; 3.7e-6 m against 1.2e-4 m at level 6,
 *   both already far finer than the 0.01 m the file stores) and costs a
 *   distinct model matrix per node.
 * - `"file"` — the file's quantization origin. Forced, and the only legal value, when
 *   `format === "int32"`: the stored integers are quantized about
 *   that origin and re-basing them would need a non-integer shift.
 */
export type OriginPolicy = "cloud" | "node" | "file";

/**
 * The frame {@link DecodedPointData.positions} lives in, carried as DATA on
 * every result so no consumer has to know a convention.
 *
 * One reconstruction formula covers both formats:
 *
 * ```
 * absolute[k] = origin[k] + positions[3 * i + k] * scale[k]
 * ```
 *
 * float32 cannot hold absolute CRS coordinates. autzen's X (635,577..640,233)
 * and Y (848,882..853,537) both live in the binade [2^19, 2^20) where the
 * float32 ULP is 0.0625 m — a measured max error of 0.030 m, THREE TIMES the
 * file's own 0.01 m quantum. Relative to the cloud origin the same points
 * reconstruct to 2.3e-4 m. Hence: emit relative, ship the origin in float64.
 */
export interface PointPositionFrame {
  readonly format: PositionFormat;
  /** float64, absolute CRS. Identical for every node under `"cloud"`. */
  readonly origin: Vec3;
  /** `[1,1,1]` for `"float32"`, the file's quantization scale for `"int32"`. */
  readonly scale: Vec3;
  readonly originPolicy: OriginPolicy;
  /**
   * Exact UPPER BOUND on |reconstructed - true| for this node, in CRS units.
   * Computed A PRIORI from the node box — half a float32 ULP at the largest
   * magnitude the box can produce, widened by one quantum because decoded values
   * may sit up to 0.94 quanta outside the box. Never derived from the data, so
   * it is valid before the first point is read. `0` for `"int32"`.
   */
  readonly maxPositionError: number;
}

/**
 * No `BigInt64Array`: int64/uint64 are in core's `UNDECODABLE_ATTRIBUTE_TYPES`
 * and never reach an output.
 */
export type DecodedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

/**
 * A WebGPU vertex format, reported so a renderer can bind an emitted array
 * without re-deriving legality — and so a build can fail when an array is not
 * bindable rather than a demo discovering it.
 *
 * Deliberately a short closed list. WebGPU has NO 3-component or 1-component
 * 8/16-bit vertex format, which is why {@link DecodedAttribute.gpuFormat} is
 * `undefined` for a native-width `Uint8Array` classification or a `Uint16Array`
 * intensity, and why {@link PointDataOptions.scalarFormat} exists.
 */
export type GpuVertexFormat =
  | "float32"
  | "float32x2"
  | "float32x3"
  | "float32x4"
  | "sint32"
  | "sint32x2"
  | "sint32x3"
  | "sint32x4"
  | "uint32"
  | "uint32x2"
  | "uint32x3"
  | "uint32x4"
  | "uint8x4"
  | "unorm8x4"
  | "sint8x4"
  | "snorm8x4"
  | "uint16x2"
  | "uint16x4"
  | "unorm16x2"
  | "unorm16x4"
  | "sint16x2"
  | "sint16x4";

/**
 * How a `numElements === 1` attribute is widened under `scalarFormat: "gpu"`.
 *
 * - `"u32"` — zero-extended. Exact for every unsigned type up to 32 bits.
 * - `"i32"` — sign-extended. Exact for int8/int16/int32, and the correct choice
 *   for an unsigned type whose declared `min` is negative — a real stock
 *   converter output: autzen's `"scan angle rank"` is uint8 with `min: [-21]`.
 * - `"f32"` — float32, applying {@link PointAttribute.normalization} when the source
 *   computed one, otherwise the raw value.
 */
export type ScalarLane = "u32" | "i32" | "f32";

/** One decoded non-position, non-colour attribute. */
export interface DecodedAttribute {
  /** VERBATIM source name: `"gps-time"`, `"scan angle rank"`. */
  readonly name: string;
  /**
   * The source descriptor, BY REFERENCE and identity-shared across every node of
   * one source. Reach through it for `min`, `max`, `histogram`, `type` and
   * `normalization`, so nothing is duplicated per node.
   */
  readonly source: PointAttribute;
  /**
   * Length `numPoints * itemSize`, elements interleaved. ALL elements are
   * decoded — both of Potree's reference decoders read element 0 and then advance the full
   * byteSize, silently truncating any multi-element attribute.
   */
  readonly array: DecodedArray;
  readonly itemSize: 1 | 2 | 3 | 4;
  /** `itemSize * array.BYTES_PER_ELEMENT`. */
  readonly byteStride: number;
  /**
   * `undefined` when this array is NOT directly bindable as a WebGPU vertex
   * buffer — every native-width 1- or 3-component 8/16-bit array, because WebGPU
   * has no such format. Pass `scalarFormat: "gpu"` for a defined value.
   */
  readonly gpuFormat: GpuVertexFormat | undefined;
  /**
   * Reconstruct the SOURCE-domain value:
   * `source = array[i] * inverse.scale + inverse.offset`. `undefined` when the
   * array already holds source-domain values. Set only for an `"f32"` lane built
   * from the attribute's `normalization`.
   */
  readonly inverse:
    | { readonly scale: number; readonly offset: number }
    | undefined;
}

/**
 * Decoded colour, always repacked to RGBA. Alpha is filled with `maxValue`; the
 * Potree reference never writes alpha at all and gets away with it only because its
 * shader binds a vec3.
 *
 * The 16->8 narrowing is decided ONCE PER SOURCE from the declared `max`, never
 * per value. Potree's `c > 255 ? c / 256 : c` is a per-scalar guess that
 * is wrong whenever a genuinely 16-bit channel lands at or below 255: measured
 * on demo/data/synthetic it destroys the hue of 213 of 17,500 points (1.22%).
 * Point 54 is raw (176, 17286, 8791) and Potree renders (176, 67, 34),
 * saturated orange, where the truth is (0, 67, 34), dark green.
 */
export interface DecodedColors {
  /** RGBA interleaved, `4 * numPoints`. */
  readonly array: Uint8Array | Uint16Array;
  /** Always defined — colour is always bindable. */
  readonly gpuFormat: GpuVertexFormat;
  /** 255 for a Uint8Array, 65535 for a Uint16Array. What alpha was filled with. */
  readonly maxValue: number;
  /** The largest value the SOURCE declares, and the input to the shift. */
  readonly declaredMax: number;
  /** 0 or 8. The per-source narrowing actually applied. */
  readonly shift: 0 | 8;
}

/**
 * One node's points. PLAIN DATA — no class, no methods, no getters, because
 * structured clone strips prototypes and this must survive a worker hop.
 *
 * Every array owns FRESH memory and NEVER aliases the input buffer, which may be
 * detached the instant a worker transfers it.
 */
export interface DecodedPointData {
  readonly nodeIndex: number;
  readonly nodeName: string;
  /** Authoritative. Never infer it from `array.length / itemSize`. */
  readonly numPoints: number;

  /** `3 * numPoints`. Interpret via {@link frame}. */
  readonly positions: Float32Array | Int32Array;
  readonly frame: PointPositionFrame;

  /** `undefined` when the source has no colour attribute, or it was deselected. */
  readonly colors: DecodedColors | undefined;

  /**
   * Selected attributes with `role === undefined`, in SOURCE order. Position
   * and colour have dedicated fields with narrower types and are deliberately
   * not duplicated here.
   */
  readonly attributes: readonly DecodedAttribute[];
  readonly attributesByName: ReadonlyMap<string, DecodedAttribute>;

  /**
   * Decoded extent in ABSOLUTE CRS, from the data. `undefined` unless
   * `computeBounds` was set.
   *
   * NOT the node box and NOT contained by it — 13,004 of 341,989 real brotli
   * points (3.80%, in 106 of 117 nodes) fall outside their derived box by up to
   * 0.94 quanta. Use this for tight culling; use the node's own box for
   * addressing.
   */
  readonly bounds: BoundingBox | undefined;

  /**
   * Every distinct output `ArrayBuffer`, exactly once, and NEVER the input
   * buffer. Computed here so no caller walks the object collecting `.buffer` —
   * that walk is exactly where Potree's two workers diverge (the DEFAULT
   * one transfers the INPUT buffer too; the brotli one's equivalent is commented
   * out).
   */
  readonly transferList: readonly ArrayBuffer[];
  /** Sum of `transferList` byte lengths. An accounting unit for a budget; O(1). */
  readonly byteLength: number;
}

/**
 * A whole-payload decompressor supplied from outside, sync or async.
 *
 * Neutral because the need is: Potree's BROTLI nodes and EPT's zstandard nodes
 * are each one compressed blob per node, and no browser exposes either codec to
 * JS. `expectedByteLength` is known exactly before decompression — a point
 * count times a stride — so an implementation can size its output once. A
 * driver that needs no such hook ignores it.
 */
export type NodeDecompress = (
  input: Uint8Array,
  expectedByteLength: number,
) => Uint8Array | Promise<Uint8Array>;


export interface PointDataOptions {
  /**
   * Which attributes to decode, BY VERBATIM SOURCE NAME.
   *
   * Default: the position-role attribute plus the colour-role one, and nothing
   * else — 16 B/pt on autzen, 170 MB for all 10,653,336 points, against the
   * Potree reference's 69 B/pt = 735 MB from a 373 MB file.
   *
   * `[]` means position only. `"all"` means every decodable attribute, with
   * int64/uint64 SKIPPED and warned. Position is ALWAYS decoded.
   *
   * An unknown name throws `"unsupported-attribute"` rather than being ignored:
   * a typo'd `"intensty"` that silently yields nothing is a worse bug.
   */
  readonly attributes?: readonly string[] | "all";
  /** `"float32"` (default) or `"int32"` (exactly lossless). */
  readonly positionFormat?: PositionFormat;
  /**
   * `"cloud"` (default) or `"node"`. Ignored, and forced to `"file"`, when
   * `positionFormat === "int32"`.
   */
  readonly origin?: "cloud" | "node";
  /** `"unorm8"` (default) gives Uint8Array RGBA; `"native"` gives Uint16Array. */
  readonly colorFormat?: "unorm8" | "native";
  /**
   * `"native"` (default) — every scalar keeps its source width. Smallest, exact,
   * and what a CPU consumer or a storage-buffer renderer wants.
   *
   * `"gpu"` — every `numElements === 1` attribute is widened to a 4-byte lane so
   * `gpuFormat` is defined for all of them. The default selection is position +
   * colour, both already GPU-legal at native width, so this changes nothing
   * unless scalars are selected.
   */
  readonly scalarFormat?: "native" | "gpu";
  /** Per-attribute lane override under `"gpu"`, keyed by verbatim name. */
  readonly lanes?: Readonly<Record<string, ScalarLane>>;
  /**
   * Fill {@link DecodedPointData.bounds}. Default `false`: it costs six
   * comparisons per point and only a scheduler wants it.
   */
  readonly computeBounds?: boolean;
}

/** Per-call options for {@link PointReader.read}. */
export interface ReadPointsOptions {
  /**
   * Aborts this node's request. Propagates as the ORIGINAL `DOMException`,
   * unwrapped.
   */
  readonly signal?: AbortSignal;
  /** Override {@link PointDataOptions.computeBounds} for this node alone. */
  readonly computeBounds?: boolean;
}

/** What a driver is told once, when a reader is opened over a cloud. */
export interface OpenPointsOptions extends PointDataOptions {
  /**
   * A decompressor for a driver that needs one supplied from outside; see
   * {@link NodeDecompress}. Ignored by a driver that does not.
   */
  readonly decompress?: NodeDecompress;
}

/**
 * Reads one node's points. THE FORMAT SEAM, named.
 *
 * A renderer walks a neutral tree and then has to turn a node into vertices,
 * and that last step is the only one that stays format-specific: Potree reads a
 * byte range out of `octree.bin` and de-interleaves a record, COPC decompresses
 * a laszip chunk from the middle of a `.laz`, EPT fetches one file per node.
 * All three produce the same {@link DecodedPointData}, so this interface is
 * where they stop differing.
 *
 * Created per cloud, not per node: every driver has plan-once work — an
 * attribute selection resolved against the source, a record layout, a laszip
 * VLR parsed into a decoder — and doing it per node is the mistake the shape of
 * the API should make hard.
 */
export interface PointReader {
  /**
   * Whether this node has bytes to fetch at all.
   *
   * Not every node in a tree does: 47 of autzen's carry no payload of their
   * own, and a COPC placeholder has none until its hierarchy page arrives. A
   * scheduler asks before dispatching rather than discovering it in a catch.
   */
  hasPayload(node: PointCloudNode): boolean;
  /**
   * The packing this reader will apply to a named scalar, or `undefined` when
   * it emits source-domain values.
   *
   * A renderer that maps an attribute onto a colour ramp needs the domain in
   * the units the DECODED lane actually carries, and the source's declared
   * `min`/`max` are in source units. Reading the transform off the reader
   * rather than recomputing it is what stops the ramp drifting away from the
   * decode.
   */
  packingFor(
    name: string,
  ): { readonly scale: number; readonly offset: number } | undefined;
  read(
    node: PointNodeRef,
    options?: ReadPointsOptions,
  ): Promise<DecodedPointData>;
  /** Release anything the reader holds. Idempotent. */
  dispose(): void;
}

/**
 * Opens a {@link PointReader} over one cloud.
 *
 * A function rather than a ready-made reader because the caller that knows the
 * cloud (the app, which also holds any driver-specific hook) and the caller
 * that knows which attributes are wanted (the renderer, which knows its colour
 * mode) are not the same caller.
 */
export type PointReaderFactory = (options?: OpenPointsOptions) => PointReader;
