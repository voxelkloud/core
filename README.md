# @voxelkloud/core

Shared types and octree math for the Potree v2 format. No I/O, no three, no DOM
— this package is the vocabulary the rest of [voxelkloud](https://github.com/voxelkloud/voxelkloud)
speaks.

```sh
npm install @voxelkloud/core
```

- `metadata.json` / `hierarchy.bin` / `octree.bin` schema types, including
  `POINT_ATTRIBUTE_TYPE_SIZE`, the width table that is the single authority on
  record stride.
- `childBoundingBox`, `childNodeName` — the octree subdivision, with the bit
  convention Potree actually uses (bit 0 is Z, bit 1 is Y, bit 2 is X).
- `mortonEncode3` / `mortonDecode3`, for the BROTLI encoding's packed positions.

Most applications never import this directly; it arrives as a dependency of
`@voxelkloud/loader`.

MIT.
