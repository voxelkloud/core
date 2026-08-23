import { describe, expect, it } from "vitest";
import {
  crsFromEpsg,
  crsFromString,
  crsFromWkt,
  wktHorizontalEpsg,
  wktName,
  wktVerticalEpsg,
} from "./crs.js";

/**
 * The Rotterdam tile's real declaration, abridged to its structure.
 *
 * Every trap in one string: six levels of nesting, an authority on the
 * spheroid, one on the datum, one on the geographic system, one on the
 * projected system, one on the vertical system, and one on the compound as a
 * whole — LAST, which is the one a naive reader takes.
 */
const COMPOUND =
  'COMPD_CS["Amersfoort / RD New + NAP height",' +
  'PROJCS["Amersfoort / RD New",' +
  'GEOGCS["Amersfoort",' +
  'DATUM["Amersfoort",SPHEROID["Bessel 1841",6377397.155,299.1528128,' +
  'AUTHORITY["EPSG","7004"]],AUTHORITY["EPSG","6289"]],' +
  'PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],' +
  'UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],' +
  'AUTHORITY["EPSG","4289"]],' +
  'PROJECTION["Oblique_Stereographic"],' +
  'PARAMETER["false_easting",155000],' +
  'UNIT["metre",1,AUTHORITY["EPSG","9001"]],' +
  'AUTHORITY["EPSG","28992"]],' +
  'VERT_CS["NAP height",VERT_DATUM["Normaal Amsterdams Peil",2005,' +
  'AUTHORITY["EPSG","5109"]],AUTHORITY["EPSG","5709"]],' +
  'AUTHORITY["EPSG","7415"]]';

describe("wktHorizontalEpsg", () => {
  it("takes the projected system's code, not the compound's", () => {
    // 7415 is the compound and 5709 the vertical; both come LATER in the
    // string. Projecting through either puts the cloud nowhere.
    expect(wktHorizontalEpsg(COMPOUND)).toBe(28992);
  });

  it("does not stop at a nested authority", () => {
    // 7004 (the spheroid), 6289 (the datum), 8901, 9122 and 4289 all appear
    // inside PROJCS before its own 28992. A reader taking the FIRST authority
    // in the node would report the Bessel ellipsoid as the CRS.
    expect(wktHorizontalEpsg(COMPOUND)).not.toBe(7004);
    expect(wktHorizontalEpsg(COMPOUND)).not.toBe(4289);
  });

  it("falls back to the geographic system when there is no projected one", () => {
    const geographic =
      'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,' +
      'AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],' +
      'AUTHORITY["EPSG","4326"]]';
    expect(wktHorizontalEpsg(geographic)).toBe(4326);
  });

  it("reads the WKT2 spelling", () => {
    // WKT2 renames the node and the authority: PROJCRS and ID.
    const wkt2 =
      'PROJCRS["NAD83 / UTM zone 12N",BASEGEOGCRS["NAD83",ID["EPSG",4269]],' +
      'CONVERSION["UTM zone 12N"],ID["EPSG",26912]]';
    expect(wktHorizontalEpsg(wkt2)).toBe(26912);
  });

  it("is not confused by a bracket inside a quoted name", () => {
    // Real citations contain them, and a bracket counter that does not know
    // about strings closes the node early and reads the wrong authority.
    const bracketed =
      'PROJCS["NAD83 / UTM zone 12N [deprecated]",' +
      'GEOGCS["NAD83",AUTHORITY["EPSG","4269"]],AUTHORITY["EPSG","26912"]]';
    expect(wktHorizontalEpsg(bracketed)).toBe(26912);
  });

  it("returns undefined for a projection that names no authority", () => {
    const custom =
      'PROJCS["a local grid",GEOGCS["x",DATUM["y",SPHEROID["z",6378137,298.3]]],' +
      'PROJECTION["Transverse_Mercator"]]';
    expect(wktHorizontalEpsg(custom)).toBeUndefined();
    expect(wktHorizontalEpsg("")).toBeUndefined();
    expect(wktHorizontalEpsg("not wkt at all")).toBeUndefined();
  });

  it("survives an unbalanced string instead of hanging", () => {
    expect(wktHorizontalEpsg('PROJCS["truncated",GEOGCS["x"')).toBeUndefined();
  });
});

describe("wktVerticalEpsg", () => {
  it("takes the vertical node's own code", () => {
    // 5109 is the vertical DATUM, nested inside; 5709 is the system.
    expect(wktVerticalEpsg(COMPOUND)).toBe(5709);
  });

  it("is undefined when there is no vertical system", () => {
    expect(
      wktVerticalEpsg('PROJCS["x",AUTHORITY["EPSG","26912"]]'),
    ).toBeUndefined();
  });
});

describe("wktName", () => {
  it("takes the outermost node's name", () => {
    expect(wktName(COMPOUND)).toBe("Amersfoort / RD New + NAP height");
    expect(wktName('PROJCS["NAD83 / UTM zone 12N",FOO]')).toBe(
      "NAD83 / UTM zone 12N",
    );
    expect(wktName("nonsense")).toBeUndefined();
  });
});

describe("crsFromString", () => {
  it("returns undefined for what PotreeConverter writes", () => {
    // Every cloud it converts carries `"projection": ""`. That is the absence
    // of a declaration, not a declaration of nothing.
    expect(crsFromString("")).toBeUndefined();
    expect(crsFromString("   ")).toBeUndefined();
    expect(crsFromString(undefined)).toBeUndefined();
  });

  it("recognises a proj4 string by its leading plus", () => {
    const crs = crsFromString("+proj=utm +zone=12 +datum=NAD83")!;
    expect(crs.format).toBe("proj4");
    expect(crs.epsg).toBeUndefined();
    expect(crs.raw).toBe("+proj=utm +zone=12 +datum=NAD83");
  });

  it("recognises a bare EPSG code", () => {
    const crs = crsFromString("EPSG:26912")!;
    expect(crs.format).toBe("epsg");
    expect(crs.epsg).toBe(26912);
    expect(crsFromString("epsg:4326")!.epsg).toBe(4326);
  });

  it("recognises WKT by its shape and resolves it", () => {
    const crs = crsFromString(COMPOUND)!;
    expect(crs.format).toBe("wkt");
    expect(crs.epsg).toBe(28992);
    expect(crs.verticalEpsg).toBe(5709);
  });

  it("keeps something it cannot classify, rather than dropping it", () => {
    // A declaration nobody can resolve is still worth reporting: `inspect`
    // saying "this file declares 'NAD83 zone 12' and I cannot parse it" beats
    // saying nothing.
    const crs = crsFromString("NAD83 zone 12")!;
    expect(crs.format).toBe("unknown");
    expect(crs.raw).toBe("NAD83 zone 12");
    expect(crs.epsg).toBeUndefined();
  });
});

describe("crsFromEpsg / crsFromWkt", () => {
  it("builds a declaration that round-trips through raw", () => {
    const epsg = crsFromEpsg(26912, { verticalEpsg: 5703, name: "UTM 12N" });
    expect(epsg).toEqual({
      format: "epsg",
      raw: "EPSG:26912",
      epsg: 26912,
      verticalEpsg: 5703,
      name: "UTM 12N",
    });
    expect(crsFromWkt(COMPOUND).raw).toBe(COMPOUND);
  });
});

/**
 * The real declaration inside `sofi.copc.laz`, a 2 GB public COPC.
 *
 * It is here because it found a bug that COMPOUND could not: its `VERT_CS` has
 * NO authority of its own, so "the last authority anywhere in the node" is the
 * metre's 9001 — reported as a vertical CRS, which is nonsense. Its `PROJCS`
 * happens to put its own authority after the unit, which is exactly what hid
 * the same fault on the horizontal side.
 */
const SOFI =
  "COMPD_CS[\"WGS 84 / UTM zone 11N\",PROJCS[\"WGS 84 / UTM zone 11N\",GEOGCS" +
  "[\"WGS 84 / UTM zone 11N\",DATUM[\"WGS84\",SPHEROID[\"WGS84\",6378137,298.25" +
  "7223563,AUTHORITY[\"EPSG\",\"7030\"]],AUTHORITY[\"EPSG\",\"6326\"]],PRIMEM[\"Gr" +
  "eenwich\",0,AUTHORITY[\"EPSG\",\"8901\"]],UNIT[\"Degree\",0.0174532925199433," +
  "AUTHORITY[\"EPSG\",\"9102\"]],AUTHORITY[\"EPSG\",\"32611\"]],PROJECTION[\"Trans" +
  "verse_Mercator\"],PARAMETER[\"latitude_of_origin\",0],PARAMETER[\"central_" +
  "meridian\",-117],PARAMETER[\"scale_factor\",0.9996],PARAMETER[\"false_east" +
  "ing\",500000],PARAMETER[\"false_northing\",0],UNIT[\"Meter\",1,AUTHORITY[\"E" +
  "PSG\",\"9001\"]],AXIS[\"Easting\",EAST],AXIS[\"Northing\",NORTH],AUTHORITY[\"E" +
  "PSG\",\"32611\"]],VERT_CS[\"Ellipsoidal Heights\",VERT_DATUM[\"Ellipsoidal H" +
  "eights\",2002,AUTHORITY[\"EPSG\",\"0\"]],UNIT[\"Meter\",1,AUTHORITY[\"EPSG\",\"9" +
  "001\"]],AXIS[\"ellipsoidal height\",UP]]]";

describe("a real file's WKT", () => {
  it("reads the horizontal system past the unit's own authority", () => {
    expect(wktHorizontalEpsg(SOFI)).toBe(32611);
    expect(wktName(SOFI)).toBe("WGS 84 / UTM zone 11N");
  });

  it("reports no vertical system rather than reporting a unit", () => {
    // VERT_CS["Ellipsoidal Heights", VERT_DATUM[..., AUTHORITY["EPSG","0"]],
    //         UNIT["Meter",1,AUTHORITY["EPSG","9001"]], AXIS[...]]
    // Nothing in there is a vertical CRS code. 9001 is the metre and 0 is the
    // writer saying there isn't one.
    expect(wktVerticalEpsg(SOFI)).toBeUndefined();
  });

  it("would not have caught this with a compound WKT alone", () => {
    // COMPOUND's PROJCS and VERT_CS both carry their own authority last, so
    // last-wins and direct-child agree on it. Only a node that omits its own
    // authority separates the two rules.
    expect(wktHorizontalEpsg(COMPOUND)).toBe(28992);
    expect(wktVerticalEpsg(COMPOUND)).toBe(5709);
  });
});
