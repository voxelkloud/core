// Potree v2 `metadata.json` schema.
//
// Field list and per-field optionality verified against:
//   - PotreeConverter's writer (Converter/src/indexer.cpp: createMetadata,
//     getAttributesJsonString)
//   - the reference client: demo/potree/src/modules/loader/2.0/OctreeLoader.js
//   - both local fixtures: demo/data/{real,synthetic}/metadata.json
//
// RULE: every `?` below is justified by a specific behaviour of the converter
// or the reference client. Do not tighten or loosen a field without updating
// the justification.
//
// This file describes the manifest AFTER validation and defaulting by
// @voxelkloud/loader. The raw JSON is deliberately never given a type — it is
// `unknown` at the parse boundary, because a type on unvalidated data is a lie.
//
// The `attributes` array is NOT modeled here. It becomes `PointAttribute[]` in
// @voxelkloud/loader, which carries the same data plus the derived record
// layout, so there is exactly one representation of the attribute list.

/**
 * A 3-component vector. A readonly tuple, so indexing stays `number` rather
 * than `number | undefined` under `noUncheckedIndexedAccess`.
 */
export type Vec3 = readonly [number, number, number];

/**
 * Canonical byte width of ONE element of each attribute type.
 *
 * This table — NOT the manifest's own `size`/`elementSize` — is the authority
 * on the per-point record stride. It mirrors
 * demo/potree/src/loader/PointAttributes.js and is what the reference decoder
 * actually walks (`this.byteSize = this.numElements * this.type.size`).
 *
 * Verified byte-exact against both fixtures:
 *   real:      12+2+1+1+1+1+1+2+8+6 = 35 B/pt;  35 * 10_653_336 = 372_866_760
 *   synthetic: 12+6                 = 18 B/pt;  18 *     17_500 =     315_000
 * each equal to the respective octree.bin length exactly.
 */
export const POINT_ATTRIBUTE_TYPE_SIZE = Object.freeze({
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  int64: 8,
  uint64: 8,
  float: 4,
  double: 8,
} as const);

/** Derived from the size table so the union and the widths can never drift. */
export type PointAttributeTypeName = keyof typeof POINT_ATTRIBUTE_TYPE_SIZE;

/**
 * Narrows an arbitrary manifest value to a known attribute type.
 *
 * Uses `Object.hasOwn` rather than a bracket lookup so a manifest with
 * `"type": "constructor"` or `"type": "__proto__"` returns false instead of
 * reaching `Object.prototype` and yielding a function. The reference client's
 * plain-object lookup has exactly this hole.
 */
export function isPointAttributeTypeName(
  value: unknown,
): value is PointAttributeTypeName {
  return (
    typeof value === "string" && Object.hasOwn(POINT_ATTRIBUTE_TYPE_SIZE, value)
  );
}

/**
 * Types that are legal in a manifest but cannot be decoded.
 *
 * The reference `DecoderWorker.js` has its 64-bit getters commented out, so it
 * throws on the first such attribute, and its `typedArrayMapping` sends both to
 * `Float64Array`, which is lossy above 2^53. The manifest must still parse —
 * the widths are known, so the record stride stays correct. Task 2 warns;
 * Task 4 throws against this set.
 */
export const UNDECODABLE_ATTRIBUTE_TYPES: ReadonlySet<PointAttributeTypeName> =
  new Set<PointAttributeTypeName>(["int64", "uint64"]);

export interface BoundingBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface HierarchyMetadata {
  /**
   * Byte length of the FIRST chunk of hierarchy.bin, starting at offset 0. The
   * only entry point into the hierarchy, and the only field of this object any
   * reference client reads.
   *
   * Real: 5654 = 257 * 22. Synthetic: 198 = 9 * 22 (the whole file).
   */
  readonly firstChunkSize: number;

  /**
   * HINT ONLY — never load-bearing. Zero readers in the reference client.
   * Truthful in the real fixture (4) and nonsense in the synthetic one (100,
   * for a 2-level tree). Task 3 MUST derive chunk layout from proxy records
   * alone.
   */
  readonly stepSize?: number;

  /** HINT ONLY. Max node level, 0-based (real: 7, i.e. 8 levels). */
  readonly depth?: number;
}

/**
 * `"DEFAULT"` and `"UNCOMPRESSED"` both mean raw interleaved fixed-stride
 * records; `"BROTLI"` means per-attribute compressed blocks with a completely
 * different on-disk layout.
 *
 * Open on purpose: PotreeConverter stores `--encoding` verbatim with zero
 * validation, and every reference client branches only on `=== "BROTLI"`. An
 * unrecognised value must parse (with a warning), not fail.
 */
export type PointCloudEncoding =
  | "DEFAULT"
  | "BROTLI"
  | "UNCOMPRESSED"
  | (string & {});

/**
 * The validated, defaulted Potree v2 manifest — everything except the
 * attribute list.
 */
export interface PointCloudMetadata {
  /**
   * `"2.0"` in both fixtures. Never read by any reference client (format
   * dispatch there is by filename). Defaults to `""` when absent.
   */
  readonly version: string;
  /** Defaults to `""`. */
  readonly name: string;
  /** Defaults to `""` — which is also what the converter actually emits. */
  readonly description: string;
  /**
   * Total point RECORDS in octree.bin. Inner nodes hold a subsampled layer that
   * is NOT duplicated in descendants, so this is the true record count:
   * `points * bytesPerPoint === octree.bin length` holds exactly in both
   * fixtures. Defaults to 0 (with a warning) when absent.
   */
  readonly points: number;
  /**
   * Opaque proj4/WKT string — NEVER parsed. PotreeConverter `master` hardcodes
   * this to `""` regardless of the source data. Defaults to `""`.
   */
  readonly projection: string;
  readonly hierarchy: HierarchyMetadata;
  /**
   * Position DECODE offset: `absolute[i] = stored[i] * scale[i] + offset[i]`.
   *
   * A DIFFERENT quantity from `boundingBox.min` (the scene origin), even though
   * PotreeConverter currently makes them elementwise equal. The reference keeps
   * them as two separate values and so do we. Never conflate.
   */
  readonly offset: Vec3;
  /** Position quantization scale. No component may be 0. */
  readonly scale: Vec3;
  /**
   * Root-node point spacing in CRS units; child spacing is `parent / 2` per
   * level. Read from the manifest, NEVER derived: it equals `side/128` exactly
   * in the real fixture but is 16x off in the synthetic one (1.25 vs 0.078125),
   * and the synthetic fixture is a supported input.
   */
  readonly spacing: number;
  /**
   * The CUBIC octree bounds in absolute CRS units. Feed THIS to
   * `childBoundingBox` — anything else desyncs traversal from the server.
   *
   * NOT the tight extent of the data: in the real fixture the cube is
   * 4655.510000000009 on all three axes while the true Z extent is 209.12, a
   * 22x overshoot. See `PointCloudSource.tightBoundingBox`.
   */
  readonly boundingBox: BoundingBox;
  readonly encoding: PointCloudEncoding;
}
