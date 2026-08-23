import { describe, expect, it, vi } from "vitest";
import { createPagedOctree } from "./paged-octree.js";
import type { OctreePage } from "./paged-octree.js";

const CUBE = { min: [0, 0, 0], max: [8, 8, 8] } as const;

type Ref = string;
type Payload = { readonly at: number };

function page(
  nodes: readonly [number, number, number, number, number][],
  links: readonly [number, number, number, number, Ref][] = [],
): OctreePage<Payload, Ref> {
  return {
    nodes: nodes.map(([level, x, y, z, pointCount]) => ({
      level,
      x,
      y,
      z,
      pointCount,
      payload: { at: pointCount },
    })),
    links: links.map(([level, x, y, z, ref]) => ({ level, x, y, z, ref })),
  };
}

function tree(
  pages: Readonly<Record<Ref, OctreePage<Payload, Ref>>>,
  overrides: Partial<Parameters<typeof createPagedOctree<Payload, Ref>>[0]> = {},
) {
  const loadPage = vi.fn(async (ref: Ref) => {
    const p = pages[ref];
    if (p === undefined) throw new Error(`no page ${ref}`);
    return p;
  });
  const t = createPagedOctree<Payload, Ref>({
    bounds: { min: [...CUBE.min], max: [...CUBE.max] },
    rootPage: "root",
    loadPage,
    geometricErrorAt: (level) => 1 / 2 ** level,
    pointSpacingAt: (level) => 1 / 2 ** level,
    ...overrides,
  });
  return { t, loadPage };
}

describe("createPagedOctree", () => {
  it("starts with an unexpanded root and fetches nothing", () => {
    const { t, loadPage } = tree({ root: page([[0, 0, 0, 0, 10]]) });
    expect(t.nodeCount).toBe(1);
    expect(t.root.level).toBe(0);
    expect(t.root.key).toBe("0-0-0-0");
    expect(t.root.childMask).toBeUndefined();
    expect(t.root.payload).toBeUndefined();
    expect(loadPage).not.toHaveBeenCalled();
  });

  it("applies one page and settles every node it declared", async () => {
    const { t } = tree({
      root: page([
        [0, 0, 0, 0, 100],
        [1, 0, 0, 0, 40],
        [1, 1, 1, 1, 60],
      ]),
    });
    await t.expand(t.root);

    expect(t.nodeCount).toBe(3);
    expect(t.root.numPoints).toBe(100);
    // Bit 0 is Z, bit 1 Y, bit 2 X — core's convention, so (1,1,1) is octant 7.
    expect(t.root.childMask).toBe(0b1000_0001);
    expect(t.nodeByKey("1-0-0-0")!.numPoints).toBe(40);
    expect(t.nodeByKey("1-1-1-1")!.numPoints).toBe(60);
    // Leaves: declared, nothing under them, so their children are known to be
    // none rather than unknown.
    expect(t.nodeByKey("1-0-0-0")!.childMask).toBe(0);
    expect(t.maxLevel).toBe(1);
  });

  it("derives child bounds by halving the parent", async () => {
    const { t } = tree({
      root: page([
        [0, 0, 0, 0, 1],
        [1, 1, 0, 1, 1],
        [2, 3, 1, 2, 1],
      ]),
    });
    await t.expand(t.root);

    const a = t.nodeByKey("1-1-0-1")!;
    expect([a.minX, a.minY, a.minZ]).toEqual([4, 0, 4]);
    expect([a.maxX, a.maxY, a.maxZ]).toEqual([8, 4, 8]);

    const b = t.nodeByKey("2-3-1-2")!;
    expect([b.minX, b.minY, b.minZ]).toEqual([6, 2, 4]);
    expect([b.maxX, b.maxY, b.maxZ]).toEqual([8, 4, 6]);
    // Every node sits inside its parent, which is what culling relies on.
    expect(b.parent).toBe(a);
    expect(b.minX).toBeGreaterThanOrEqual(a.minX);
    expect(b.maxZ).toBeLessThanOrEqual(a.maxZ);
  });

  it("materialises ancestors a page skipped", async () => {
    // Nothing requires a page to list a parent before a child, and COPC's do
    // not in general.
    const { t } = tree({ root: page([[3, 5, 2, 1, 7]]) });
    await t.expand(t.root);

    const deep = t.nodeByKey("3-5-2-1")!;
    expect(deep.numPoints).toBe(7);
    expect(t.nodeByKey("2-2-1-0")).toBe(deep.parent);
    expect(t.nodeByKey("1-1-0-0")).toBe(deep.parent!.parent);
    expect(deep.parent!.parent!.parent).toBe(t.root);
  });

  it("turns a link into a placeholder, then fills it in", async () => {
    const { t, loadPage } = tree({
      root: page([[0, 0, 0, 0, 100]], [[1, 0, 0, 0, "sub"]]),
      sub: page([
        [1, 0, 0, 0, 40],
        [2, 1, 0, 0, 12],
      ]),
    });
    await t.expand(t.root);

    const placeholder = t.nodeByKey("1-0-0-0")!;
    // Zero points and an unknown child mask is exactly what makes a scheduler
    // ask for the expansion that fills it in.
    expect(placeholder.numPoints).toBe(0);
    expect(placeholder.payload).toBeUndefined();
    expect(placeholder.childMask).toBeUndefined();
    expect(loadPage).toHaveBeenCalledTimes(1);

    await t.expand(placeholder);
    expect(placeholder.numPoints).toBe(40);
    expect(placeholder.payload).toEqual({ at: 40 });
    // (2,1,0,0) is octant 4, so the mask bit is 1 << 4.
    expect(placeholder.childMask).toBe(0b1_0000);
    expect(t.nodeByKey("2-1-0-0")!.numPoints).toBe(12);
    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(t.stats.pagesLoaded).toBe(2);
  });

  it("lets a link win over an entry in the same page", async () => {
    // A page may declare a node and then say its subtree continues elsewhere.
    const { t } = tree({
      root: page(
        [
          [0, 0, 0, 0, 100],
          [1, 0, 0, 0, 40],
        ],
        [[1, 0, 0, 0, "sub"]],
      ),
      sub: page([
        [1, 0, 0, 0, 40],
        [2, 0, 0, 1, 5],
      ]),
    });
    await t.expand(t.root);
    const linked = t.nodeByKey("1-0-0-0")!;
    expect(linked.childMask).toBeUndefined();

    await t.expand(linked);
    expect(linked.childMask).toBe(0b10);
  });

  it("fetches a shared page once for concurrent expands", async () => {
    const { t, loadPage } = tree({
      root: page([[0, 0, 0, 0, 1]], [
        [1, 0, 0, 0, "shared"],
        [1, 1, 0, 0, "shared"],
      ]),
      shared: page([
        [1, 0, 0, 0, 2],
        [1, 1, 0, 0, 3],
      ]),
    });
    await t.expand(t.root);
    await Promise.all([
      t.expand(t.nodeByKey("1-0-0-0")!),
      t.expand(t.nodeByKey("1-1-0-0")!),
    ]);
    expect(loadPage).toHaveBeenCalledTimes(2); // root + shared, not root + 2
  });

  it("expandAll walks every link, however deep", async () => {
    const { t } = tree({
      root: page([[0, 0, 0, 0, 1]], [[1, 0, 0, 0, "a"]]),
      a: page([[1, 0, 0, 0, 2]], [[2, 0, 0, 0, "b"]]),
      b: page([[2, 0, 0, 0, 3]], [[3, 0, 0, 0, "c"]]),
      c: page([[3, 0, 0, 0, 4]]),
    });
    await t.expandAll();
    expect(t.nodeCount).toBe(4);
    expect(t.maxLevel).toBe(3);
    expect(t.nodeByKey("3-0-0-0")!.numPoints).toBe(4);
    for (let i = 0; i < t.nodeCount; i++) {
      expect(t.node(i)!.childMask).toBeDefined();
    }
  });

  it("settles a node whose page never mentioned it", async () => {
    // An empty page means "this subtree is a leaf", not "ask again" — without
    // this a caller that keeps asking would spin.
    const { t } = tree({
      root: page([[0, 0, 0, 0, 1]], [[1, 0, 0, 0, "empty"]]),
      empty: page([]),
    });
    await t.expand(t.root);
    const node = t.nodeByKey("1-0-0-0")!;
    await t.expand(node);
    expect(node.childMask).toBe(0);
    expect(t.tryExpandSync(node)).toBe(true);
  });

  it("ignores a key outside the range its own level allows", async () => {
    const { t } = tree({
      root: page([
        [0, 0, 0, 0, 1],
        [1, 2, 0, 0, 9], // level 1 has cells 0..1
      ]),
    });
    await t.expand(t.root);
    expect(t.nodeCount).toBe(1);
    expect(t.warnings.map((w) => w.code)).toEqual([
      "hierarchy-key-out-of-range",
    ]);
  });

  it("stops at maxDepth and says so once", async () => {
    const { t } = tree(
      {
        root: page([
          [0, 0, 0, 0, 1],
          [3, 0, 0, 0, 1],
          [4, 0, 0, 0, 1],
        ]),
      },
      { maxDepth: 2 },
    );
    await t.expand(t.root);
    expect(t.maxLevel).toBeLessThanOrEqual(2);
    expect(t.warnings).toHaveLength(1);
    expect(t.warnings[0]!.code).toBe("hierarchy-depth-exceeded");
  });

  it("stops at maxNodes", async () => {
    const { t } = tree(
      {
        root: page([
          [0, 0, 0, 0, 1],
          [1, 0, 0, 0, 1],
          [1, 1, 0, 0, 1],
          [1, 0, 1, 0, 1],
        ]),
      },
      { maxNodes: 3 },
    );
    await t.expand(t.root);
    expect(t.nodeCount).toBe(3);
    expect(t.warnings[0]!.code).toBe("hierarchy-node-limit");
  });

  it("backs off after a failure and retries when the window passes", async () => {
    let clock = 1000;
    const failures = { count: 0 };
    const t = createPagedOctree<Payload, Ref>({
      bounds: { min: [0, 0, 0], max: [8, 8, 8] },
      rootPage: "root",
      loadPage: async () => {
        if (failures.count++ === 0) throw new Error("boom");
        return page([[0, 0, 0, 0, 5]]);
      },
      geometricErrorAt: (l) => 1 / 2 ** l,
      pointSpacingAt: (l) => 1 / 2 ** l,
      now: () => clock,
      retryDelayMs: () => 500,
    });

    await expect(t.expand(t.root)).rejects.toThrow(/boom/);
    // Inside the window the same error comes back without a second request.
    await expect(t.expand(t.root)).rejects.toThrow(/boom/);
    expect(failures.count).toBe(1);

    clock += 500;
    await t.expand(t.root);
    expect(t.root.numPoints).toBe(5);
    expect(failures.count).toBe(2);
  });

  it("requestExpand is a no-op inside the backoff window", async () => {
    let clock = 0;
    const loadPage = vi.fn(async () => {
      throw new Error("nope");
    });
    const t = createPagedOctree<Payload, Ref>({
      bounds: { min: [0, 0, 0], max: [8, 8, 8] },
      rootPage: "root",
      loadPage,
      geometricErrorAt: (l) => 1 / 2 ** l,
      pointSpacingAt: (l) => 1 / 2 ** l,
      now: () => clock,
      retryDelayMs: () => 1000,
    });

    t.requestExpand(t.root);
    await vi.waitFor(() => expect(loadPage).toHaveBeenCalledTimes(1));
    // A render loop asking every frame must not become a request storm.
    for (let i = 0; i < 60; i++) t.requestExpand(t.root);
    await Promise.resolve();
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it("gives up on a page that keeps failing", async () => {
    let clock = 0;
    const t = createPagedOctree<Payload, Ref>({
      bounds: { min: [0, 0, 0], max: [8, 8, 8] },
      rootPage: "root",
      loadPage: async () => {
        throw new Error("always");
      },
      geometricErrorAt: (l) => 1 / 2 ** l,
      pointSpacingAt: (l) => 1 / 2 ** l,
      now: () => clock,
      retryDelayMs: () => 10,
      maxAttempts: 2,
    });
    await expect(t.expand(t.root)).rejects.toThrow();
    clock += 100;
    await expect(t.expand(t.root)).rejects.toThrow();
    clock += 100;
    // Exhausted: no retryAfter, so it stays failed without another request.
    await expect(t.expand(t.root)).rejects.toThrow();
    expect(t.root.childMask).toBeUndefined();
  });

  it("caps concurrent page requests", async () => {
    let active = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const links: [number, number, number, number, Ref][] = [];
    for (let i = 0; i < 8; i++) links.push([1, i & 1, (i >> 1) & 1, i >> 2, `p${i}`]);

    const t = createPagedOctree<Payload, Ref>({
      bounds: { min: [0, 0, 0], max: [8, 8, 8] },
      rootPage: "root",
      loadPage: async (ref) => {
        if (ref === "root") return page([[0, 0, 0, 0, 1]], links);
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((r) => release.push(r));
        active--;
        return page([]);
      },
      geometricErrorAt: (l) => 1 / 2 ** l,
      pointSpacingAt: (l) => 1 / 2 ** l,
      maxConcurrentPageRequests: 3,
    });

    await t.expand(t.root);
    const all = t.expandAll();
    await vi.waitFor(() => expect(release.length).toBe(3));
    while (release.length > 0) {
      release.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    await all;
    expect(peak).toBe(3);
  });

  it("boundingRadiusAt halves with the level", () => {
    const { t } = tree({ root: page([]) });
    const r0 = t.boundingRadiusAt(0);
    expect(r0).toBeCloseTo(0.5 * Math.hypot(8, 8, 8), 12);
    expect(t.boundingRadiusAt(3)).toBeCloseTo(r0 / 8, 12);
  });

  it("dispose aborts what is in flight", async () => {
    let aborted = false;
    const t = createPagedOctree<Payload, Ref>({
      bounds: { min: [0, 0, 0], max: [8, 8, 8] },
      rootPage: "root",
      loadPage: (_ref, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      geometricErrorAt: (l) => 1 / 2 ** l,
      pointSpacingAt: (l) => 1 / 2 ** l,
    });
    const pending = t.expand(t.root).catch(() => undefined);
    t.dispose();
    await pending;
    expect(aborted).toBe(true);
    t.dispose(); // idempotent
  });
});
