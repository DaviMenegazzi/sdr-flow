import { describe, it, expect } from "vitest";
import {
  normalizePhoneDigits,
  getBrazilianPhoneVariations,
  isPhoneNumberMatch,
} from "../../packages/shared/src/phone.js";

describe("Phone Utils", () => {
  it("should normalize phone digits", () => {
    expect(normalizePhoneDigits("5555999998888@s.whatsapp.net")).toBe("5555999998888");
    expect(normalizePhoneDigits("+55 (55) 99999-8888")).toBe("5555999998888");
    expect(normalizePhoneDigits("5551999998888:1@s.whatsapp.net")).toBe("5551999998888");
    expect(normalizePhoneDigits("")).toBe("");
    expect(normalizePhoneDigits(null)).toBe("");
    expect(normalizePhoneDigits(undefined)).toBe("");
  });

  it("should match phone numbers correctly", () => {
    // Exact match
    expect(isPhoneNumberMatch("5555999998888@s.whatsapp.net", "5555999998888")).toBe(true);

    // Formatted input in config
    expect(isPhoneNumberMatch("5555999998888@s.whatsapp.net", "+55 (55) 99999-8888")).toBe(true);

    // Suffix match (e.g. without country code 55 in config)
    expect(isPhoneNumberMatch("5555999998888@s.whatsapp.net", "55999998888")).toBe(true);

    // Multiple comma-separated numbers in config
    expect(
      isPhoneNumberMatch("5551988887777@s.whatsapp.net", "5555999998888, 5551988887777")
    ).toBe(true);

    // Non-matching number
    expect(isPhoneNumberMatch("5511911112222@s.whatsapp.net", "5555999998888")).toBe(false);
    expect(isPhoneNumberMatch("5511911112222@s.whatsapp.net", "")).toBe(false);
    expect(isPhoneNumberMatch("", "5555999998888")).toBe(false);
  });
});
