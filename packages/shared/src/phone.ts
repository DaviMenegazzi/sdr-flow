/**
 * Utility functions for Brazilian and international WhatsApp phone normalization and matching.
 */

export function normalizePhoneDigits(phone?: string | null): string {
  if (!phone) return "";

  let cleaned = phone;
  // Strip WhatsApp domain if present
  if (cleaned.includes("@")) {
    cleaned = (cleaned.split("@")[0] ?? "");
  }

  // Strip multi-device identifier if present (e.g. 5551999998888:2)
  if (cleaned.includes(":")) {
    cleaned = (cleaned.split(":")[0] ?? "");
  }

  return cleaned.replace(/\D/g, "");
}

export function getBrazilianPhoneVariations(digits: string): Set<string> {
  const variations = new Set<string>();
  if (!digits || !/^\d+$/.test(digits)) {
    if (digits) variations.add(digits);
    return variations;
  }

  variations.add(digits);

  let d = digits;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    d = d.substring(2);
  }

  // Now d is 10 digits (DDD + 8) or 11 digits (DDD + 9)
  if (d.length === 10) {
    const ddd = d.substring(0, 2);
    const num8 = d.substring(2);
    variations.add(num8);
    variations.add("9" + num8);
    variations.add(d);
    variations.add(`${ddd}9${num8}`);
    variations.add(`55${d}`);
    variations.add(`55${ddd}9${num8}`);
  } else if (d.length === 11 && d[2] === "9") {
    const ddd = d.substring(0, 2);
    const num8 = d.substring(3);
    variations.add(num8);
    variations.add("9" + num8);
    variations.add(`${ddd}${num8}`);
    variations.add(d);
    variations.add(`55${ddd}${num8}`);
    variations.add(`55${d}`);
  } else if (digits.length === 8) {
    variations.add("9" + digits);
  } else if (digits.length === 9 && digits.startsWith("9")) {
    variations.add(digits.substring(1));
  }

  return variations;
}

export function isPhoneNumberMatch(
  incomingJidOrPhone?: string | null,
  testPhoneConfig?: string | null
): boolean {
  if (!incomingJidOrPhone || !testPhoneConfig) {
    return false;
  }

  const incomingDigits = normalizePhoneDigits(incomingJidOrPhone);
  if (!incomingDigits) {
    return false;
  }

  const incomingVariations = getBrazilianPhoneVariations(incomingDigits);

  // Split multiple test numbers by comma or semicolon
  const rawAllowed = testPhoneConfig
    .replace(/;/g, ",")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  for (const allowedRaw of rawAllowed) {
    const allowedDigits = normalizePhoneDigits(allowedRaw);
    if (!allowedDigits) continue;

    // 1. Exact match on clean digits
    if (incomingDigits === allowedDigits) {
      return true;
    }

    // 2. Match via Brazilian phone variations (8 vs 9 digits, DDD, with/without 55)
    const allowedVariations = getBrazilianPhoneVariations(allowedDigits);
    for (const v of allowedVariations) {
      if (incomingVariations.has(v) && v.length >= 8) {
        return true;
      }
    }

    // 3. Suffix / Substring match
    if (allowedDigits.length >= 8 && incomingDigits.length >= 8) {
      if (incomingDigits.endsWith(allowedDigits) || allowedDigits.endsWith(incomingDigits)) {
        return true;
      }
    }
  }

  return false;
}
