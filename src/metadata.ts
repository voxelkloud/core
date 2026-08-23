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
