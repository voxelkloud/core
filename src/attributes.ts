import type { PointAttributeTypeName } from "./metadata.js";

// Neutral attribute vocabulary. The names and widths are whatever the source
// format declared; the ROLE tags are how a renderer finds position and colour
// without knowing which format produced them.


/**
 * The only two attributes with a non-generic decode path in the reference
 * decoder. Deliberately a closed 2-member union, not an open taxonomy:
 * everything else (intensity, classification, gps-time, ...) goes down the
 * generic branch and is found by name via `attributesByName`.
 *
 * Assigned by exact-name membership, which collapses three aliases the
 * reference scatters across two files:
 *   position: "position" | "POSITION_CARTESIAN"
 *   color:    "rgb" | "rgba" | "RGBA"
 */
export type AttributeRole = "position" | "color";

/** One source attribute plus the record-layout arithmetic derived from it. */
export interface PointAttribute {
  /**
   * VERBATIM from the manifest. Never renamed, slugified or camelCased — this
   * is the on-disk identity. Real names contain spaces and a hyphen: "return
   * number", "number of returns", "scan angle rank", "user data", "point source
   * id", "gps-time". In particular `"rgb"` stays `"rgb"`.
   */
  readonly name: string;
  /**
   * Derived semantic tag; `undefined` for everything else. Task 4 dispatches on
   * this, never on name strings.
   */
  readonly role: AttributeRole | undefined;
  /** `""` when the manifest omits it (which is also what the converter emits). */
  readonly description: string;
  readonly type: PointAttributeTypeName;
  readonly numElements: number;
  /**
   * `POINT_ATTRIBUTE_TYPE_SIZE[type]` — the canonical width, NOT the manifest's
   * declared `elementSize` (which is cross-checked, warned on, then discarded).
   */
  readonly elementSize: number;
  /** `numElements * elementSize`. This attribute's stride contribution. */
  readonly byteSize: number;
  /**
   * Byte offset of this attribute within one point record.
   *
   * @remarks Meaningful only when `encoding` is `"DEFAULT"` or
   * `"UNCOMPRESSED"`. A BROTLI stream decompresses to per-attribute contiguous
   * blocks with attribute-specific widths and this value does not apply.
   */
  readonly byteOffset: number;
  /**
   * SEMANTIC bounds in the attribute's own domain, length exactly
   * `numElements`. Copied verbatim and NEVER validated against `type`:
   *   - "scan angle rank" is `uint8` with `min: [-21]` (LAS stores a signed
   *     rank in a raw byte) — a stock PotreeConverter output.
   *   - "position" is `int32` with non-integer doubles, because position
   *     min/max are in absolute CRS units (post scale+offset).
   * `min[i] > max[i]` and `min[i] === max[i]` are both tolerated.
   */
  readonly min: readonly number[];
  readonly max: readonly number[];
  /**
   * Per-element affine transform, length `numElements`. All-1s / all-0s when
   * the manifest omits them (the synthetic fixture omits both). Read by NOBODY
   * in the entire reference codebase, which is why a non-identity value earns a
   * warning.
   *
   * NOT the position quantization — that is the TOP-LEVEL
   * `metadata.scale`/`metadata.offset`. `position` carries `scale: [1,1,1]`
   * here while the real quantization is `[0.01,0.01,0.01]`.
   */
  readonly scale: readonly number[];
  readonly offset: readonly number[];
  /**
   * Value histogram, 256 buckets in practice. Emitted by PotreeConverter for
   * ANY attribute with `size === 1` whose buckets are not all zero — it is not
   * classification-specific, it just happens to appear only there in the real
   * fixture, where it sums to exactly `metadata.points`. Length is NOT
   * validated.
   */
  readonly histogram: readonly number[] | undefined;
  /**
   * Constants for packing this attribute's values into a float32 buffer:
   * `f32 = (value - offset) * scale`, exactly as the reference decoder does.
   *
   * Present ONLY when `numElements === 1 && elementSize > 4` (double, int64,
   * uint64) — the case where the reference computes `scale = 1/(max-min)` and a
   * degenerate range yields `Infinity`, turning every decoded value into NaN.
   * The `(max - min) || 1` guard is baked in here, and a degenerate range also
   * emits a `degenerate-range` warning.
   *
   * This is the generalised form of potree's `if (name === "gps-time")` hack
   * (potree/potree#909): the root cause is the WIDTH, not the name, so a
   * converter emitting `"gpsTime"` is covered too.
   *
   * `undefined` means no packing is needed — use the raw value.
   */
  readonly normalization:
    | { readonly offset: number; readonly scale: number }
    | undefined;
}
