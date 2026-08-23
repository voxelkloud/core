import type { PointAttribute } from "./attributes.js";
import type { CrsDeclaration } from "./crs.js";
import type { BoundingBox } from "./metadata.js";
import type { PointCloudTransport } from "./transport.js";
import type { PointCloudWarning } from "./warnings.js";

/**
 * What EVERY format driver must be able to say about a cloud, minus its points.
 *
 * This is the contract `@voxelkloud/view` is written against. Nothing here names
 * a file, an encoding or a manifest: a driver for Potree v2, COPC, EPT or a
 * tileset all produce this shape, and the renderer cannot tell them apart.
 *
 * A driver adds its own fields on top — `PotreeSource` carries `metadata`,
 * `urls`, `bytesPerPoint` and `isBrotli` — and code that reaches for those has
 * deliberately chosen to be format-specific.
 */
export interface PointCloudSourceBase {
  /** In source order. For a record-oriented format this IS the field order. */
  readonly attributes: readonly PointAttribute[];
  /**
   * O(1) lookup, built once. On a duplicate name (warned, never thrown) the
   * FIRST occurrence wins; `attributes` keeps both with correct offsets.
   */
  readonly attributesByName: ReadonlyMap<string, PointAttribute>;
  /**
   * The INDEXING volume — the cube an octree subdivides, which is what node
   * bounds are expressed against and what the renderer takes its origin from.
   * NOT the data extent: on autzen this is 22x taller than the points.
   */
  readonly bounds: BoundingBox;
  /**
   * The genuinely tight data extent in absolute CRS units. This is what camera
   * fit-to-view and elevation ramps want.
   *
   * Potree's field of the same name is a clone of the CUBIC box, i.e. not tight
   * at all: on autzen it reports a Z extent of 4655.51 against a true 209.12.
   */
  readonly tightBoundingBox: BoundingBox;
  /** Total points in the cloud, across every level. */
  readonly pointCount: number;
  /**
   * The coordinate reference system the file declares, or `undefined` when it
   * declares none.
   *
   * `undefined` is common and not an error: a photogrammetry scan sits in an
   * arbitrary local frame, and PotreeConverter drops the projection of
   * everything it converts. A cloud with no CRS renders fine — it just cannot
   * be placed next to one from somewhere else.
   */
  readonly crs?: CrsDeclaration | undefined;
  /** Tolerated anomalies, in discovery order. */
  readonly warnings: readonly PointCloudWarning[];
  /** Reuse this for every subsequent request against this cloud. */
  readonly transport: PointCloudTransport;
}
