export const VOXELKLOUD_CORE_VERSION = "0.0.0";

export {
  POINT_ATTRIBUTE_TYPE_SIZE,
  UNDECODABLE_ATTRIBUTE_TYPES,
  isPointAttributeTypeName,
} from "./metadata.js";
export type {
  BoundingBox,
  HierarchyMetadata,
  PointAttributeTypeName,
  PointCloudEncoding,
  PointCloudMetadata,
  Vec3,
} from "./metadata.js";

export {
  HIERARCHY_NODE_BYTE_SIZE,
  HIERARCHY_NODE_FIELD_OFFSET,
  HierarchyNodeType,
} from "./hierarchy.js";
export type { HierarchyNodeRecord } from "./hierarchy.js";

export {
  childBoundingBox,
  childNodeName,
  mortonDecode3,
  mortonEncode3,
} from "./octree-math.js";
export type { ChildIndex } from "./octree-math.js";
