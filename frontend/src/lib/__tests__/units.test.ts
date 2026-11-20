import { describe, it, expect } from "vitest";
import {
  getPrimaryParticleDiameterNm,
  getScaleFactorNm,
  getSchemaVersion,
  DEFAULT_DIAMETER_NM,
  SCHEMA_VERSION_CURRENT,
  PARAM_KEY_DIAMETER,
  PARAM_KEY_RADIUS_LEGACY,
  PARAM_KEY_SCALE_NM,
  PARAM_KEY_SCHEMA_VERSION,
} from "../units";

describe("constants", () => {
  it("DEFAULT_DIAMETER_NM is 50.0", () => {
    expect(DEFAULT_DIAMETER_NM).toBe(50.0);
  });

  it("SCHEMA_VERSION_CURRENT is 'v2'", () => {
    expect(SCHEMA_VERSION_CURRENT).toBe("v2");
  });

  it("key constants match documented names", () => {
    expect(PARAM_KEY_DIAMETER).toBe("primary_particle_diameter_nm");
    expect(PARAM_KEY_RADIUS_LEGACY).toBe("primary_particle_radius_nm");
    expect(PARAM_KEY_SCALE_NM).toBe("scale_nm");
    expect(PARAM_KEY_SCHEMA_VERSION).toBe("parameters_schema_version");
  });
});

describe("getPrimaryParticleDiameterNm", () => {
  it("v2 present returns diameter", () => {
    expect(
      getPrimaryParticleDiameterNm({ primary_particle_diameter_nm: 30.0 }),
    ).toBe(30.0);
  });

  it("only legacy radius returns radius * 2", () => {
    expect(
      getPrimaryParticleDiameterNm({ primary_particle_radius_nm: 20.0 }),
    ).toBe(40.0);
  });

  it("neither present returns default 50.0", () => {
    expect(getPrimaryParticleDiameterNm({})).toBe(50.0);
  });

  it("both present, v2 wins (legacy ignored)", () => {
    expect(
      getPrimaryParticleDiameterNm({
        primary_particle_diameter_nm: 30.0,
        primary_particle_radius_nm: 99.0,
      }),
    ).toBe(30.0);
  });

  it("legacy zero falls through to default", () => {
    expect(
      getPrimaryParticleDiameterNm({ primary_particle_radius_nm: 0 }),
    ).toBe(50.0);
  });

  it("legacy negative falls through to default", () => {
    expect(
      getPrimaryParticleDiameterNm({ primary_particle_radius_nm: -5.0 }),
    ).toBe(50.0);
  });

  it("v2 zero falls through to legacy", () => {
    expect(
      getPrimaryParticleDiameterNm({
        primary_particle_diameter_nm: 0,
        primary_particle_radius_nm: 20.0,
      }),
    ).toBe(40.0);
  });

  it("v2 negative falls through to legacy", () => {
    expect(
      getPrimaryParticleDiameterNm({
        primary_particle_diameter_nm: -10.0,
        primary_particle_radius_nm: 20.0,
      }),
    ).toBe(40.0);
  });

  it("v2 NaN falls through to legacy", () => {
    expect(
      getPrimaryParticleDiameterNm({
        primary_particle_diameter_nm: Number.NaN,
        primary_particle_radius_nm: 20.0,
      }),
    ).toBe(40.0);
  });

  it("v2 Infinity falls through to legacy", () => {
    expect(
      getPrimaryParticleDiameterNm({
        primary_particle_diameter_nm: Number.POSITIVE_INFINITY,
        primary_particle_radius_nm: 20.0,
      }),
    ).toBe(40.0);
  });

  it("both invalid falls through to default", () => {
    expect(
      getPrimaryParticleDiameterNm({
        primary_particle_diameter_nm: 0,
        primary_particle_radius_nm: -1,
      }),
    ).toBe(50.0);
  });

  it("null params returns default", () => {
    expect(getPrimaryParticleDiameterNm(null)).toBe(50.0);
  });

  it("undefined params returns default", () => {
    expect(getPrimaryParticleDiameterNm(undefined)).toBe(50.0);
  });

  it("non-numeric v2 value falls through", () => {
    expect(
      getPrimaryParticleDiameterNm({
        primary_particle_diameter_nm: "30",
        primary_particle_radius_nm: 20.0,
      }),
    ).toBe(40.0);
  });
});

describe("getScaleFactorNm", () => {
  it("returns diameter / 2 for v2 params", () => {
    expect(
      getScaleFactorNm({ primary_particle_diameter_nm: 50.0 }),
    ).toBe(25.0);
  });

  it("returns (radius * 2) / 2 = radius for v1 params", () => {
    expect(
      getScaleFactorNm({ primary_particle_radius_nm: 25.0 }),
    ).toBe(25.0);
  });

  it("returns default / 2 = 25 for empty params", () => {
    expect(getScaleFactorNm({})).toBe(25.0);
  });

  it("returns default / 2 = 25 for null params", () => {
    expect(getScaleFactorNm(null)).toBe(25.0);
  });
});

describe("getScaleFactorNm — explicit scale_nm (#197)", () => {
  // Parity with backend/apps/simulations/tests/test_params_shim.py: every
  // case here has the same expected value there. A guard added to only one
  // shim made the screen and the CSV export disagree (issue #197, PR #348).
  it("explicit scale_nm is the factor itself — first priority", () => {
    expect(getScaleFactorNm({ scale_nm: 1.0 })).toBe(1.0);
  });

  it("scale_nm outranks the v2 diameter key, same order as the backend", () => {
    expect(
      getScaleFactorNm({ scale_nm: 1.0, primary_particle_diameter_nm: 24.0 }),
    ).toBe(1.0);
  });

  it("scale_nm absent keeps the historical diameter/2 behaviour", () => {
    expect(getScaleFactorNm({ primary_particle_diameter_nm: 30.0 })).toBe(15.0);
    expect(getScaleFactorNm({ primary_particle_radius_nm: 12.5 })).toBe(12.5);
  });

  it("scale_nm 0 falls through to diameter / 2", () => {
    expect(
      getScaleFactorNm({ scale_nm: 0, primary_particle_diameter_nm: 24.0 }),
    ).toBe(12.0);
  });

  it("scale_nm negative falls through to diameter / 2", () => {
    expect(
      getScaleFactorNm({ scale_nm: -2.0, primary_particle_diameter_nm: 24.0 }),
    ).toBe(12.0);
  });

  it("scale_nm string falls through to diameter / 2", () => {
    expect(
      getScaleFactorNm({ scale_nm: "1.0", primary_particle_diameter_nm: 24.0 }),
    ).toBe(12.0);
  });

  it("scale_nm NaN falls through to diameter / 2", () => {
    expect(
      getScaleFactorNm({
        scale_nm: Number.NaN,
        primary_particle_diameter_nm: 24.0,
      }),
    ).toBe(12.0);
  });

  it("scale_nm Infinity falls through to diameter / 2", () => {
    expect(
      getScaleFactorNm({
        scale_nm: Number.POSITIVE_INFINITY,
        primary_particle_diameter_nm: 24.0,
      }),
    ).toBe(12.0);
  });

  it("a dimensionless import keeps the default-diameter path", () => {
    // What the import stamps for unit=dimensionless: default diameter, no
    // explicit factor — same expectation as the Python mirror.
    expect(getScaleFactorNm({ primary_particle_diameter_nm: 50.0 })).toBe(25.0);
  });
});

describe("getSchemaVersion", () => {
  // Parity with backend/apps/simulations/tests/test_params_shim.py
  it("explicit v2 returns 'v2'", () => {
    expect(
      getSchemaVersion({ parameters_schema_version: SCHEMA_VERSION_CURRENT }),
    ).toBe("v2");
  });

  it("explicit v1 returns 'v1'", () => {
    expect(
      getSchemaVersion({ parameters_schema_version: "v1" }),
    ).toBe("v1");
  });

  it("inferred v2 from diameter key present", () => {
    expect(
      getSchemaVersion({ primary_particle_diameter_nm: 30.0 }),
    ).toBe("v2");
  });

  it("inferred v1 from legacy radius key present", () => {
    expect(
      getSchemaVersion({ primary_particle_radius_nm: 15.0 }),
    ).toBe("v1");
  });

  it("null for fully ambiguous params (empty / unrelated keys)", () => {
    expect(getSchemaVersion({})).toBeNull();
    expect(getSchemaVersion({ unrelated_key: 123 })).toBeNull();
  });

  it("explicit version overrides inference", () => {
    expect(
      getSchemaVersion({
        parameters_schema_version: "v1",
        primary_particle_diameter_nm: 30.0,
      }),
    ).toBe("v1");
  });

  it("null / non-object input returns null", () => {
    expect(getSchemaVersion(null)).toBeNull();
    expect(getSchemaVersion(undefined)).toBeNull();
  });

  it("inference uses KEY PRESENCE, not positivity — diameter=0 still → 'v2'", () => {
    // Matches Python semantics: `PARAM_KEY_DIAMETER in p` is True even for 0/NaN.
    expect(
      getSchemaVersion({
        primary_particle_diameter_nm: 0,
        primary_particle_radius_nm: 25.0,
      }),
    ).toBe("v2");
  });
});
