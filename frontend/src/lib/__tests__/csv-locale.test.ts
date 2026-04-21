import { describe, it, expect } from "vitest";
import {
  detectCsvLocale,
  previewCsv,
  stripMetadataComments,
} from "../csv-locale";

/**
 * Locked against the backend parser in backend/apps/simulations/utils.py.
 * If backend detection changes, these tests must change with it.
 */

describe("stripMetadataComments", () => {
  it("extracts unit, diameter, source, generated_at from metadata block", () => {
    const text = [
      "#unit=nm",
      "#primary_particle_diameter_nm=30",
      "#source=manual",
      "#generated_at=2026-04-21T10:00:00Z",
      "x,y,z,radius",
      "0,0,0,1",
    ].join("\n");

    const { metadata, body } = stripMetadataComments(text);
    expect(metadata.unit).toBe("nm");
    expect(metadata.primary_particle_diameter_nm).toBe(30);
    expect(metadata.source).toBe("manual");
    expect(metadata.generated_at).toBe("2026-04-21T10:00:00Z");
    // Body starts with the header row.
    expect(body.split("\n")[0]).toBe("x,y,z,radius");
  });

  it("skips malformed metadata lines but keeps real metadata", () => {
    const text = [
      "# not a pair",
      "#unit=nm",
      "#=no-key",
      "#source=manual",
      "x,y,z,radius",
      "0,0,0,1",
    ].join("\n");

    const { metadata } = stripMetadataComments(text);
    expect(metadata.unit).toBe("nm");
    expect(metadata.source).toBe("manual");
    // Malformed lines do not explode the parser.
    expect(metadata._unknown_keys).toBeUndefined();
  });

  it("preserves unknown keys in _unknown_keys", () => {
    const text = [
      "#wavelength=532",
      "#unit=nm",
      "x,y,z,radius",
      "0,0,0,1",
    ].join("\n");

    const { metadata } = stripMetadataComments(text);
    expect(metadata.unit).toBe("nm");
    expect(metadata._unknown_keys).toBeDefined();
    expect(metadata._unknown_keys?.wavelength).toBe("532");
  });

  it("stops metadata scan at first non-# line", () => {
    const text = [
      "#unit=nm",
      "x,y,z,radius",
      "#not-metadata=ignored-below-header",
      "0,0,0,1",
    ].join("\n");

    const { metadata, body } = stripMetadataComments(text);
    expect(metadata.unit).toBe("nm");
    // The `#not-metadata=` line appears after header → must remain in body
    // (not stripped, not treated as metadata).
    expect(body).toContain("#not-metadata=ignored-below-header");
  });
});

describe("detectCsvLocale", () => {
  it("US format: dot decimal, comma delimiter", () => {
    const body = [
      "x,y,z,radius",
      "1.5,2.5,3.5,0.25",
      "1.6,2.6,3.6,0.25",
      "1.7,2.7,3.7,0.25",
      "1.8,2.8,3.8,0.25",
      "1.9,2.9,3.9,0.25",
    ].join("\n");

    const locale = detectCsvLocale(body);
    expect(locale.decimal).toBe(".");
    expect(locale.delimiter).toBe(",");
    expect(locale.warning).toBe(false);
  });

  it("European format: comma decimal, semicolon delimiter", () => {
    const body = [
      "x;y;z;radius",
      "1,5;2,5;3,5;0,25",
      "1,6;2,6;3,6;0,25",
      "1,7;2,7;3,7;0,25",
      "1,8;2,8;3,8;0,25",
      "1,9;2,9;3,9;0,25",
    ].join("\n");

    const locale = detectCsvLocale(body);
    expect(locale.decimal).toBe(",");
    expect(locale.delimiter).toBe(";");
    expect(locale.warning).toBe(false);
  });

  it("mixed dot-decimal with semicolon delimiter", () => {
    const body = [
      "x;y;z;radius",
      "1.5;2.5;3.5;0.25",
      "1.6;2.6;3.6;0.25",
      "1.7;2.7;3.7;0.25",
      "1.8;2.8;3.8;0.25",
      "1.9;2.9;3.9;0.25",
    ].join("\n");

    const locale = detectCsvLocale(body);
    expect(locale.decimal).toBe(".");
    expect(locale.delimiter).toBe(";");
    expect(locale.warning).toBe(false);
  });

  it("small sample (< 5 data rows) sets warning flag", () => {
    const body = ["x,y,z,radius", "1.0,2.0,3.0,0.25", "1.1,2.1,3.1,0.25"].join(
      "\n",
    );

    const locale = detectCsvLocale(body);
    expect(locale.warning).toBe(true);
  });

  it("empty body defaults to dot + comma with warning", () => {
    const locale = detectCsvLocale("");
    expect(locale.decimal).toBe(".");
    expect(locale.delimiter).toBe(",");
    expect(locale.warning).toBe(true);
  });
});

describe("previewCsv (integration)", () => {
  it("returns metadata + locale + first 5 parsed rows", () => {
    const text = [
      "#unit=nm",
      "#primary_particle_diameter_nm=30",
      "x,y,z,radius",
      "0.0,0.0,0.0,1.0",
      "2.0,0.0,0.0,1.0",
      "4.0,0.0,0.0,1.0",
      "6.0,0.0,0.0,1.0",
      "8.0,0.0,0.0,1.0",
      "10.0,0.0,0.0,1.0",
      "12.0,0.0,0.0,1.0",
    ].join("\n");

    const preview = previewCsv(text);
    expect(preview.metadata.unit).toBe("nm");
    expect(preview.metadata.primary_particle_diameter_nm).toBe(30);
    expect(preview.locale.decimal).toBe(".");
    expect(preview.locale.delimiter).toBe(",");
    expect(preview.headerRow).toEqual(["x", "y", "z", "radius"]);
    expect(preview.firstDataRows).toHaveLength(5);
    expect(preview.firstDataRows[0]).toEqual(["0.0", "0.0", "0.0", "1.0"]);
    // Total rows (excluding header).
    expect(preview.rowCount).toBe(7);
  });

  it("metadata-only file produces empty data with warning", () => {
    const text = ["#unit=nm", "#source=manual"].join("\n");
    const preview = previewCsv(text);
    expect(preview.metadata.unit).toBe("nm");
    expect(preview.firstDataRows).toEqual([]);
    expect(preview.rowCount).toBe(0);
    expect(preview.locale.warning).toBe(true);
  });

  it("European CSV with metadata parses correctly end-to-end", () => {
    const text = [
      "#unit=nm",
      "x;y;z;radius",
      "1,5;2,5;3,5;0,25",
      "1,6;2,6;3,6;0,25",
      "1,7;2,7;3,7;0,25",
      "1,8;2,8;3,8;0,25",
      "1,9;2,9;3,9;0,25",
    ].join("\n");

    const preview = previewCsv(text);
    expect(preview.locale.decimal).toBe(",");
    expect(preview.locale.delimiter).toBe(";");
    expect(preview.headerRow).toEqual(["x", "y", "z", "radius"]);
    expect(preview.firstDataRows[0]).toEqual(["1,5", "2,5", "3,5", "0,25"]);
  });
});
