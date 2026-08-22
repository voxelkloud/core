import { describe, expect, it } from "vitest";
import type { BoundingBox } from "./metadata.js";
import {
  childBoundingBox,
  childNodeName,
  mortonDecode3,
  mortonEncode3,
} from "./octree-math.js";

const ROOT: BoundingBox = { min: [0, 0, 0], max: [10, 10, 10] };

describe("childBoundingBox", () => {
  it("index 0 (all lower octant) shrinks toward min", () => {
    expect(childBoundingBox(ROOT, 0)).toEqual({
      min: [0, 0, 0],
      max: [5, 5, 5],
    });
  });

  it("index 7 (all upper octant) shrinks toward max", () => {
    expect(childBoundingBox(ROOT, 7)).toEqual({
      min: [5, 5, 5],
      max: [10, 10, 10],
    });
  });

  it("bit0 controls Z, bit1 controls Y, bit2 controls X", () => {
    // index 1 = 0b001 -> +Z only
    expect(childBoundingBox(ROOT, 1)).toEqual({
      min: [0, 0, 5],
      max: [5, 5, 10],
    });
    // index 2 = 0b010 -> +Y only
    expect(childBoundingBox(ROOT, 2)).toEqual({
      min: [0, 5, 0],
      max: [5, 10, 5],
    });
    // index 4 = 0b100 -> +X only
    expect(childBoundingBox(ROOT, 4)).toEqual({
      min: [5, 0, 0],
      max: [10, 5, 5],
    });
  });

  it("all 8 children exactly partition the parent volume", () => {
    let volume = 0;
    for (let i = 0; i < 8; i++) {
      const child = childBoundingBox(ROOT, i as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7);
      volume +=
        (child.max[0] - child.min[0]) *
        (child.max[1] - child.min[1]) *
        (child.max[2] - child.min[2]);
    }
    expect(volume).toBe(1000);
  });
});

describe("childNodeName", () => {
  it("appends the child index to the parent name", () => {
    expect(childNodeName("r", 0)).toBe("r0");
    expect(childNodeName("r3", 5)).toBe("r35");
  });
});

describe("morton encode/decode", () => {
  it("round-trips arbitrary coordinates", () => {
    const cases: Array<[number, number, number]> = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1023, 1023, 1023],
      [37, 512, 901],
    ];
    for (const [x, y, z] of cases) {
      expect(mortonDecode3(mortonEncode3(x, y, z))).toEqual([x, y, z]);
    }
  });

  it("interleaves bits with x in the lowest position", () => {
    expect(mortonEncode3(1, 0, 0)).toBe(1);
    expect(mortonEncode3(0, 1, 0)).toBe(2);
    expect(mortonEncode3(0, 0, 1)).toBe(4);
  });
});
