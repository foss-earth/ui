import { describe, expect, it } from "vitest";
import { formatNumber } from "../src/settings/values.js";

describe("a setting's number as the panels show it", () => {
  it("rounds to whole numbers from 100, to hundredths from 1 and to thousandths below, with thousands separators", () => {
    expect([123456.7, 100.5, 99.995, 12.345, 1, 0.12345, 0.0004, 0, -0, -1234.5].map(formatNumber))
      .toEqual(["123,457", "101", "100", "12.35", "1", "0.123", "0", "0", "-0", "-1,234"]);
  });

  it("writes what is not a finite number as JavaScript does", () => {
    expect([Number.NaN, Infinity, -Infinity].map(formatNumber)).toEqual(["NaN", "Infinity", "-Infinity"]);
  });
});
