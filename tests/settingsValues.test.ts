import { describe, expect, it } from "vitest";
import { formatNumber, numberFaces, parseShownNumber } from "../src/settings/values.js";

describe("a setting's number as the panels show it", () => {
  it("rounds to whole numbers from 100, to hundredths from 1 and to thousandths below, with thousands separators", () => {
    expect([123456.7, 100.5, 99.995, 12.345, 1, 0.12345, 0.0004, 0, -0, -1234.5].map(formatNumber))
      .toEqual(["123,457", "101", "100", "12.35", "1", "0.123", "0", "0", "-0", "-1,234"]);
  });

  it("writes what is not a finite number as JavaScript does", () => {
    expect([Number.NaN, Infinity, -Infinity].map(formatNumber)).toEqual(["NaN", "Infinity", "-Infinity"]);
  });
});

describe("a slider's number, as its field and handle write it", () => {
  const written = (faces: ReturnType<typeof numberFaces>, value: number): string => {
    const face = faces.show(value);
    return `${face.sign}${face.pad}${face.digits}`;
  };
  const across = (spec: Parameters<typeof numberFaces>[0], bounds: { min: number; max: number }, values: number[]): string[] => {
    const faces = numberFaces(spec, bounds);
    return values.map(value => written(faces, value));
  };

  it("keeps one character count across the range, with leading zeros and the step's decimals", () => {
    expect(across({ unit: "fps", step: 0.25, scale: "log2" }, { min: 10, max: 240 }, [10, 60, 99.6, 240])).toEqual(["010", "060", "100", "240"]);
    expect(across({ unit: "ratio", step: 0.25, scale: "log2" }, { min: 0.25, max: 2 }, [0.25, 0.297, 1, 2])).toEqual(["0.25", "0.30", "1.00", "2.00"]);
    expect(across({ unit: "deg", step: 1 }, { min: 10, max: 120 }, [10, 60, 120])).toEqual(["010", "060", "120"]);
    expect(across({ unit: "fraction", step: 0.01 }, { min: 0, max: 1 }, [0, 0.5, 1])).toEqual(["000", "050", "100"]);
    expect(across({ unit: "MiB", scale: "log2" }, { min: 32, max: 1024 }, [32, 300, 1024])).toEqual(["0032", "0300", "1024"]);
    expect(across({ unit: "samples", step: 1, scale: "log2" }, { min: 1, max: 16 }, [1, 4, 16])).toEqual(["01", "04", "16"]);
  });

  it("marks every value's sign when the range goes below zero, and none on zero", () => {
    expect(across({ unit: "deg", step: 0.5 }, { min: -90, max: 90 }, [-90, -0.2, -0.04, 0, 45.5])).toEqual(["−90.0", "−00.2", "±00.0", "±00.0", "+45.5"]);
  });

  it("shortens large values to three figures and k, M or G", () => {
    expect(across({ unit: "m" }, { min: 0.1, max: 10_737_418 }, [0.1, 1500, 10_737_418])).toEqual(["00.10", "1.50k", "10.7M"]);
    expect(across({ unit: "count", step: 0.05, scale: "log2" }, { min: 1000, max: 200_000 }, [1000, 12_000, 200_000, 999_999])).toEqual(["1.00k", "12.0k", "0200k", "1.00M"]);
  });

  it("writes the pad and the number apart, so the zeros can be drawn faint", () => {
    expect(numberFaces({ unit: "fps", step: 1 }, { min: 10, max: 240 }).show(10)).toEqual({ pad: "0", sign: "", digits: "10" });
  });

  it("rounds a value to what it writes, so the value set is the value shown", () => {
    const faces = numberFaces({ unit: "ratio", step: 0.25, scale: "log2" }, { min: 0.25, max: 2 });
    expect([0.2973, 1.6818, 2].map(faces.round)).toEqual([0.3, 1.68, 2]);
  });

  it("reads a typed number with separators, a minus sign or a k, M or G", () => {
    expect(["1,024", "−5", "-0.25", "10.7M", "1.5k", "+3", "abc", "", "1.2.3"].map(parseShownNumber))
      .toEqual([1024, -5, -0.25, 10_700_000, 1500, 3, null, null, null]);
  });
});
