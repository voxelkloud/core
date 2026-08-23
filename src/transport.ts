// Neutral transport vocabulary. Every format driver reaches its bytes through
// this, so a caller configures auth, signing, caching and retry ONCE and it
// applies to whichever driver ends up serving the URL.


/**
 * The `fetch` shape this package needs.
 *
 * `input` is narrowed to `string` deliberately: the global `fetch` (whose
 * parameter is the wider `RequestInfo | URL`) stays assignable by
 * contravariance, and so does a user hook typed `(input: string, ...)`. We
 * always call it with a string.
 */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/**
 * How this source reaches its remaining files.
 *
 * Carried on {@link PointCloudSource} so Tasks 3 and 4 inherit the caller's
 * auth, signing, caching and retry policy instead of falling back to a bare
 * global `fetch` — the still-open bug tentone/potree-core#54, where
 * metadata.json loads with an auth header and every node request then 401s.
 *
 * Deliberately carries NO `AbortSignal`: a signal scoped to the manifest load
 * must not silently abort later hierarchy/point requests. Every subsequent call
 * takes its own. Headers live inside `requestInit`; there is exactly one static
 * hook and one dynamic hook, not three.
 */
export interface PointCloudTransport {
  readonly fetch: FetchLike;
  /**
   * Merged into every request Tasks 3 and 4 make. They must merge headers via
   * `const h = new Headers(requestInit?.headers); h.set("Range", ...)` so the
   * `Headers`, array and record forms all work, and must always override
   * `signal` with their own per-request signal.
   */
  readonly requestInit: RequestInit | undefined;
}

export interface PointCloudTransportOptions {
  /** Defaults to the global `fetch` (Node >= 20, all modern browsers). */
  readonly fetch?: FetchLike;
  /**
   * Baseline init for every request, now and in Tasks 3/4. Put
   * `headers: { Authorization: ... }` here.
   */
  readonly requestInit?: RequestInit;
}
