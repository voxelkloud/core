// `hierarchy.bin` node record layout. Confirmed against
// demo/potree's src/modules/loader/2.0/OctreeLoader.js (NodeLoader.parseHierarchy):
// u8 type, u8 childMask, u32 numPoints (LE), i64 byteOffset (LE), i64 byteSize (LE).
export const HIERARCHY_NODE_BYTE_SIZE = 22;

export const HIERARCHY_NODE_FIELD_OFFSET = {
  type: 0,
  childMask: 1,
  numPoints: 2,
  byteOffset: 6,
  byteSize: 14,
} as const;

// type === Proxy means this record's byteOffset/byteSize point at a further
// chunk of hierarchy.bin (to be fetched and parsed) rather than into
// octree.bin — the only distinction the reference loader actually branches on.
//
// `type` has NO other reader semantics. Measured on real converter output: 660
// records typed Leaf(1) carry a NON-ZERO childMask, and 8 synthetic records
// typed Normal(0) carry childMask 0 — so neither direction of "Leaf means
// childless" holds. childMask is the ONLY has-children signal. Branching on
// type would silently drop 4120 of autzen's 4377 nodes while completing without
// error. In autzen the type-0 set is exactly the set of chunk head records.
export const HierarchyNodeType = {
  Normal: 0,
  Leaf: 1,
  Proxy: 2,
} as const;
export type HierarchyNodeType =
  (typeof HierarchyNodeType)[keyof typeof HierarchyNodeType];

/**
 * One decoded 22-byte hierarchy.bin record.
 *
 * `byteOffset`/`byteSize` are `number`, not `bigint`, even though the wire
 * format is i64 LE. Readers decode the i64 as two uint32s and reject a set sign
 * bit or a value >= 2^53, which is STRICTLY STRONGER than bigint: bigint
 * silently accepts a hostile 2^62 offset that then produces an unsatisfiable
 * Range header. Measured headroom: the largest value in any known converter
 * output is 372,487,605 against Number.MAX_SAFE_INTEGER = 9.007e15 — nine
 * petabytes of octree.bin. Numbers also keep a node JSON-stringifiable and
 * avoid the reference's silently type-fragile `=== 0n` guards (`0 === 0n` is
 * false).
 */
export interface HierarchyNodeRecord {
  type: HierarchyNodeType;
  childMask: number;
  numPoints: number;
  byteOffset: number;
  byteSize: number;
}
