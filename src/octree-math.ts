import type { BoundingBox } from "./metadata.js";

export type ChildIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// Bit convention confirmed against demo/potree's createChildAABB
// (src/modules/loader/2.0/OctreeLoader.js): bit0 -> Z, bit1 -> Y, bit2 -> X.
// Getting this backwards silently misaligns node traversal against the
// server's octree, so it's pinned to the reference implementation rather
// than re-derived.
export function childBoundingBox(
  box: BoundingBox,
  childIndex: ChildIndex,
): BoundingBox {
  const [minX, minY, minZ] = box.min;
  const [maxX, maxY, maxZ] = box.max;
  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;

  let loX = minX;
  let hiX = maxX;
  let loY = minY;
  let hiY = maxY;
  let loZ = minZ;
  let hiZ = maxZ;

  if (childIndex & 0b001) loZ += sizeZ / 2;
  else hiZ -= sizeZ / 2;
  if (childIndex & 0b010) loY += sizeY / 2;
  else hiY -= sizeY / 2;
  if (childIndex & 0b100) loX += sizeX / 2;
  else hiX -= sizeX / 2;

  return { min: [loX, loY, loZ], max: [hiX, hiY, hiZ] };
}

// gridSize=32 density grid) or similar per-node spatial indexing.
function spreadBits3(value: number): number {
  let x = value & 0x3ff;
  x = (x | (x << 16)) & 0x30000ff;
  x = (x | (x << 8)) & 0x300f00f;
  x = (x | (x << 4)) & 0x30c30c3;
  x = (x | (x << 2)) & 0x9249249;
  return x;
}

function compactBits3(value: number): number {
  let x = value & 0x9249249;
  x = (x | (x >> 2)) & 0x30c30c3;
  x = (x | (x >> 4)) & 0x300f00f;
  x = (x | (x >> 8)) & 0x30000ff;
  x = (x | (x >> 16)) & 0x3ff;
  return x;
}

// x, y, z must be integers in [0, 1023].
export function mortonEncode3(x: number, y: number, z: number): number {
  return spreadBits3(x) | (spreadBits3(y) << 1) | (spreadBits3(z) << 2);
}

export function mortonDecode3(code: number): [number, number, number] {
  return [compactBits3(code), compactBits3(code >> 1), compactBits3(code >> 2)];
}
