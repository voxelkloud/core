# @voxelkloud/core

The vocabulary every layer of [voxelkloud](../../README.md) speaks. No I/O, no
three, no DOM.

```sh
npm install @voxelkloud/core
```

**Neutral by construction.** Nothing here names a file, a manifest or an
encoding. Drivers for Potree v2, COPC, EPT or a tileset all express themselves
in these types, which is what lets `@voxelkloud/view` be written against a
contract instead of against one format.

- `PointCloudSourceBase` — what every driver must be able to say about a cloud:
  attributes, the indexing volume, the tight data extent, point count, warnings,
  transport.
- `PointCloudTreeBase` / `PointCloudNode` — the LOD tree the scheduler reads.
  Note the deliberate split between `geometricErrorAt` (what refinement is
  decided on) and `pointSpacingAt` (what sizes a point and places the near
  plane): they are the same number on a point octree and diverge the moment a
  format's LOD quantum is not a point pitch.
- `PointCloudFormat` — the driver contract: sniff, load, open the tree.
- `PointAttribute`, `PointCloudTransport`, `PointCloudWarning`,
  `VoxelkloudError` — shared attribute, transport, anomaly and error vocabulary.
- `childBoundingBox`, `mortonEncode3` / `mortonDecode3` — regular-octree
  subdivision and Morton order, shared by Potree v2, COPC and EPT, which
  partition space identically and differ only in naming and on-disk record.

Most applications never import this directly; it arrives as a dependency of
`@voxelkloud/loader`, which re-exports the types you are likely to name.

MIT.
