// @voxelkloud/core — the vocabulary every layer speaks.
//
// NEUTRAL BY CONSTRUCTION: nothing here names a file, a manifest or an
// encoding. A driver for Potree v2, COPC, EPT or a tileset all express
// themselves in these types, which is what lets @voxelkloud/view be written
// against the contract instead of against one format. The Potree v2 schema
// itself lives in @voxelkloud/format-potree.
export const VOXELKLOUD_CORE_VERSION = "0.0.0";

export {
  POINT_ATTRIBUTE_TYPE_SIZE,
  UNDECODABLE_ATTRIBUTE_TYPES,
  isPointAttributeTypeName,
} from "./metadata.js";
export type {
  BoundingBox,
  PointAttributeTypeName,
  Vec3,
} from "./metadata.js";

// Regular-octree subdivision and Morton order. Shared by every octree format —
// Potree v2, COPC and EPT partition space identically; only the naming and the
// on-disk record differ.
export {
  childBoundingBox,
  mortonDecode3,
  mortonEncode3,
} from "./octree-math.js";
export type { ChildIndex } from "./octree-math.js";

export type { AttributeRole, PointAttribute } from "./attributes.js";
export type {
  FetchLike,
  PointCloudTransport,
  PointCloudTransportOptions,
} from "./transport.js";
export type { PointCloudWarning } from "./warnings.js";
export type { PointCloudSourceBase } from "./source.js";

// The CRS a file declares. Declaration only — projecting through one needs an
// EPSG table and a projection engine, which is @voxelkloud/wasm-proj.
export {
  crsFromEpsg,
  crsFromString,
  crsFromWkt,
  wktHorizontalEpsg,
  wktName,
  wktVerticalEpsg,
} from "./crs.js";
export type { CrsDeclaration, CrsFormat } from "./crs.js";
export type { PointCloudNode, PointCloudTreeBase } from "./tree.js";

// The node payload. Neutral because a decoded node is the same object whichever
// driver produced it; `PointReader` is where the drivers stop differing.
export type {
  DecodedArray,
  DecodedAttribute,
  DecodedColors,
  DecodedPointData,
  GpuVertexFormat,
  NodeDecompress,
  OpenPointsOptions,
  OriginPolicy,
  PointDataOptions,
  PointNodeRef,
  PointPositionFrame,
  PointReader,
  PointReaderFactory,
  PositionFormat,
  ReadPointsOptions,
  ScalarLane,
} from "./points.js";

// The paged octree Potree v2, COPC and EPT all describe. Structure and math
// only: `loadPage` is the sole way bytes enter, so this stays free of transport
// policy while still owning what three drivers would each get subtly wrong.
export { createPagedOctree } from "./paged-octree.js";
export type {
  OctreeKey,
  OctreePage,
  OctreePageLink,
  OctreePageNode,
  PagedOctree,
  PagedOctreeNode,
  PagedOctreeOptions,
  PagedOctreeWarning,
  PagedOctreeWarningCode,
} from "./paged-octree.js";

export type {
  FormatProbe,
  LoadSourceOptions,
  PointCloudFormat,
} from "./format.js";

export { VoxelkloudError, fail, isVoxelkloudError } from "./errors.js";
export type {
  VoxelkloudErrorCode,
  VoxelkloudErrorOptions,
} from "./errors.js";
