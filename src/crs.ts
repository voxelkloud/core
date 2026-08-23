// What a file says about its coordinate reference system.
//
// DECLARATION, not a projection. Reading a CRS out of a file and being able to
// project through it are different jobs with different costs: every driver does
// the first, and it is a few hundred bytes of parsing; the second needs an
// EPSG table and a projection engine, which is a separate opt-in package. A
// driver that put them together would drag 200 KB of projections into a bundle
// that only wanted to know what the numbers mean.
//
// So this is the neutral shape a driver fills in, and `@voxelkloud/wasm-proj`
// is what turns one into something you can transform through.

/** How a file spelled its CRS. */
export type CrsFormat =
  /** An EPSG code, from a GeoTIFF key or an `srs.authority`/`srs.horizontal` pair. */
  | "epsg"
  /** OGC Well-Known Text, WKT1 or WKT2. */
  | "wkt"
  /** A proj4 string: `"+proj=utm +zone=12 +datum=NAD83"`. */
  | "proj4"
  /** Something was declared and none of the above recognised it. */
  | "unknown";

/**
 * A cloud's coordinate reference system, as declared.
 *
 * `undefined` on a source means the file said NOTHING — which is common and not
 * an error: a photogrammetry scan in an arbitrary local frame has no CRS, and
 * PotreeConverter drops the projection of everything it converts. A cloud with
 * no CRS can be viewed; it just cannot be placed next to one from elsewhere.
 */
export interface CrsDeclaration {
  readonly format: CrsFormat;
  /** Verbatim, whatever the file held. The only lossless field here. */
  readonly raw: string;
  /**
   * EPSG code of the HORIZONTAL system, when it could be determined.
   *
   * For `"wkt"` this is extracted from the authority the projected (or, failing
   * that, geographic) node carries — see {@link wktHorizontalEpsg} for why that
   * is not simply the last authority in the string.
   */
  readonly epsg: number | undefined;
  /**
   * EPSG code of the VERTICAL system, separately, when the file declared one.
   *
   * Kept apart from `epsg` because nothing in this project transforms heights
   * between vertical datums, and a compound code that silently stood in for a
   * horizontal one would produce a projection that is wrong by the datum
   * separation — tens of metres.
   */
  readonly verticalEpsg: number | undefined;
  /** The human name the file gave, when it gave one. */
  readonly name: string | undefined;
}

/**
 * The EPSG code of a WKT's horizontal system.
 *
 * NOT the last `AUTHORITY` in the string, which is the trap: a real compound
 * WKT ends
 * `COMPD_CS["Amersfoort / RD New + NAP height", PROJCS[... "EPSG","28992"], VERT_CS[... "EPSG","5709"], AUTHORITY["EPSG","7415"]]`
 * and the last two codes are the vertical system and the compound as a whole.
 * Projecting through either places the cloud nowhere.
 *
 * So: find the first `PROJCS` (or `GEOGCS` when there is no projected system),
 * match its brackets, and take the authority that closes THAT node.
 *
 * @returns the code, or `undefined` for a WKT that names no authority — a
 *   custom projection, which is legal and which this cannot resolve.
 */
export function wktHorizontalEpsg(wkt: string): number | undefined {
  const node = firstNode(wkt, ["PROJCS", "PROJCRS"]) ?? firstNode(wkt, ["GEOGCS", "GEOGCRS"]);
  if (node === undefined) return undefined;
  return directAuthorityIn(node);
}

/** The EPSG code of a WKT's vertical system, when it declares one. */
export function wktVerticalEpsg(wkt: string): number | undefined {
  const node = firstNode(wkt, ["VERT_CS", "VERTCRS"]);
  return node === undefined ? undefined : directAuthorityIn(node);
}

/** The name a WKT's outermost node carries. */
export function wktName(wkt: string): string | undefined {
  const match = /^\s*[A-Z_]+\s*\[\s*"([^"]*)"/u.exec(wkt);
  return match?.[1];
}

/**
 * The text of the first node with one of these keywords, brackets balanced.
 *
 * Bracket matching rather than a regex because a WKT nests six levels deep and
 * a non-greedy match stops at the first `]`, which is inside a SPHEROID.
 */
function firstNode(wkt: string, keywords: readonly string[]): string | undefined {
  for (const keyword of keywords) {
    const start = wkt.indexOf(`${keyword}[`);
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    for (let i = start + keyword.length; i < wkt.length; i++) {
      const c = wkt[i];
      // Brackets inside a quoted name are text, not structure. Real citations
      // contain them: `PROJCS["NAD83 / UTM zone 12N [deprecated]"]`.
      if (c === '"') inString = !inString;
      else if (!inString && c === "[") depth++;
      else if (!inString && c === "]") {
        depth--;
        if (depth === 0) return wkt.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

/**
 * The `AUTHORITY["EPSG",n]` / `ID["EPSG",n]` that is a DIRECT CHILD of a node.
 *
 * Not the last one anywhere in its text, which is the trap a real file found: a
 * `VERT_CS` with no authority of its own still contains
 * `UNIT["Meter",1,AUTHORITY["EPSG","9001"]]`, and 9001 is EPSG's code for the
 * metre. Reported as a CRS it is nonsense; reported as the HORIZONTAL crs — the
 * same thing happens to a `PROJCS` that omits its own authority — it is a
 * projection through a unit, which fails or, worse, does not.
 *
 * So the bracket depth is tracked and only authorities sitting immediately
 * inside the node count.
 */
function directAuthorityIn(node: string): number | undefined {
  const open = node.indexOf("[");
  if (open < 0) return undefined;

  let depth = 1;
  let inString = false;
  let code: number | undefined;

  for (let i = open + 1; i < node.length; i++) {
    const c = node[i];
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "[") {
      if (depth === 1) {
        const keyword = keywordEndingAt(node, i);
        if (keyword === "AUTHORITY" || keyword === "ID") {
          const match = /^\s*"?EPSG"?\s*,\s*"?(\d+)"?\s*\]/iu.exec(
            node.slice(i + 1),
          );
          if (match !== null) {
            const value = Number(match[1]);
            // 0 is what a writer emits for "there isn't one" — a real file
            // declares `VERT_DATUM[..., AUTHORITY["EPSG","0"]]`.
            if (Number.isSafeInteger(value) && value > 0) code = value;
          }
        }
      }
      depth++;
    } else if (c === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  return code;
}

/** The bare keyword immediately before an opening bracket. */
function keywordEndingAt(text: string, bracket: number): string {
  let start = bracket;
  while (start > 0 && /[A-Za-z_]/u.test(text[start - 1]!)) start--;
  return text.slice(start, bracket).toUpperCase();
}

/** Build a declaration from an OGC WKT string. */
export function crsFromWkt(wkt: string): CrsDeclaration {
  return {
    format: "wkt",
    raw: wkt,
    epsg: wktHorizontalEpsg(wkt),
    verticalEpsg: wktVerticalEpsg(wkt),
    name: wktName(wkt),
  };
}

/** Build a declaration from an EPSG code. */
export function crsFromEpsg(
  epsg: number,
  options: { readonly verticalEpsg?: number; readonly name?: string } = {},
): CrsDeclaration {
  return {
    format: "epsg",
    raw: `EPSG:${epsg}`,
    epsg,
    verticalEpsg: options.verticalEpsg,
    name: options.name,
  };
}

/**
 * Build a declaration from whatever a manifest field held.
 *
 * Potree's `projection` and EPT's `srs.wkt` are both "a string, and the writer
 * decided what kind" — so the kind is sniffed here rather than assumed.
 * `undefined` for an empty string, which is what PotreeConverter writes for
 * every cloud it converts and is not a declaration at all.
 */
export function crsFromString(text: string | undefined): CrsDeclaration | undefined {
  const raw = text?.trim();
  if (raw === undefined || raw === "") return undefined;
  if (raw.startsWith("+")) {
    return { format: "proj4", raw, epsg: undefined, verticalEpsg: undefined, name: undefined };
  }
  const epsgOnly = /^EPSG:(\d+)$/iu.exec(raw);
  if (epsgOnly !== null) return crsFromEpsg(Number(epsgOnly[1]));
  if (/^\s*[A-Z_]+\s*\[/u.test(raw)) return crsFromWkt(raw);
  return { format: "unknown", raw, epsg: undefined, verticalEpsg: undefined, name: undefined };
}
