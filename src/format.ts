import type { PointCloudSourceBase } from "./source.js";
import type { OpenPointsOptions, PointReader } from "./points.js";
import type { PointCloudTreeBase } from "./tree.js";
import type { PointCloudTransportOptions } from "./transport.js";

/** Options every driver must accept. A driver may extend, never narrow. */
export interface LoadSourceOptions extends PointCloudTransportOptions {
  /**
   * The document the engine already fetched while identifying the format.
   *
   * A driver that recognises `probe.url` as the document it was about to fetch
   * MUST parse it instead of fetching again — identification would otherwise
   * cost every load a duplicate round trip.
   */
  readonly probe?: FormatProbe;
  /**
   * Aborts the MANIFEST request only. Deliberately not retained on the returned
   * source — later hierarchy and point requests take their own signals.
   */
  readonly signal?: AbortSignal;
}

/**
 * What a driver is shown when the engine asks "is this yours?".
 *
 * Fetched ONCE and offered to every candidate, so adding a driver costs no
 * extra round trip. `json` is `undefined` when the body did not parse as JSON,
 * which is itself a discriminator: COPC and raw LAZ are binary.
 */
export interface FormatProbe {
  /** Absolute URL of the document that was fetched. */
  readonly url: string;
  /** Parsed body, when it was JSON. `undefined` otherwise. */
  readonly json: unknown;
  /** First bytes decoded as text, for magic numbers such as `"LASF"`. */
  readonly head: string;
  /**
   * The same prefix, undecoded.
   *
   * A BINARY format cannot identify itself from `head`: the text decode turns
   * every byte outside ASCII into U+FFFD, so an offset in the string is not an
   * offset in the file and a structure cannot be walked. COPC is the case that
   * proved it — telling a COPC from an ordinary LAZ means finding a VLR by user
   * id at a computed offset, which is arithmetic on bytes.
   *
   * `undefined` only when the body could not be read as bytes at all.
   */
  readonly bytes: Uint8Array | undefined;
  /** `Content-Type` as served, lowercased, without parameters. */
  readonly contentType: string | undefined;
}

/**
 * A format driver, as the registry sees it.
 *
 * CONFIDENCE, not a boolean: several formats are served from a bare directory
 * and only the content separates them, so a driver says how sure it is and the
 * engine picks the maximum. The scale is deliberately coarse —
 *   0  not mine
 *   1  the URL shape is compatible, nothing more
 *   2  a discriminator matched
 *   3  a discriminator matched AND the document is self-consistent
 * — because a finer scale would invite tuning that the fixtures cannot justify.
 */
export interface PointCloudFormat<
  S extends PointCloudSourceBase = PointCloudSourceBase,
> {
  /** Stable machine id, e.g. `"potree-v2"`. Used in errors and diagnostics. */
  readonly id: string;
  /** Human label for messages, e.g. `"Potree v2"`. */
  readonly label: string;
  /**
   * Cheap and SYNCHRONOUS: URL shape only, no I/O. Run before anything is
   * fetched, to ORDER the candidates.
   */
  sniffUrl(url: string): number;
  /**
   * Which document identifies this format, given the caller's URL.
   *
   * A bare directory is the common input and every format answers it
   * differently — Potree wants `metadata.json`, EPT wants `ept.json`, 3D Tiles
   * wants `tileset.json` — so there is no single document the engine could
   * fetch on a driver's behalf. Returning `undefined` means "this URL cannot be
   * mine", and the engine skips the fetch entirely.
   */
  probeUrl(url: string): string | undefined;
  /** Definitive, against the fetched document. */
  sniff(probe: FormatProbe): number;
  load(url: string | URL, options: LoadSourceOptions): Promise<S>;
  /**
   * Open the LOD tree for a source THIS driver produced.
   *
   * Part of the contract rather than a driver-specific call because it is the
   * step between "identify the cloud" and "draw it": without it a caller that
   * loaded a source through the registry would have to switch on the format
   * again to find out how to get a tree, and the dispatch would have bought
   * nothing.
   */
  openTree(source: S, options?: LoadSourceOptions): Promise<PointCloudTreeBase>;
  /**
   * Open a reader for the node payloads of a source THIS driver produced.
   *
   * The last format-specific step, and the reason it is on the contract rather
   * than left to the caller: a renderer walks a neutral tree and then has to
   * turn a node into vertices. Without this it would switch on the format again
   * at exactly the point the registry exists to remove the switch — which is
   * what `@voxelkloud/view` did until there was a second driver to prove it.
   *
   * SYNCHRONOUS and cheap: everything expensive was done by `load`. Callers
   * open a reader per cloud and per attribute selection, not per node.
   */
  openPoints(source: S, options?: OpenPointsOptions): PointReader;
}
