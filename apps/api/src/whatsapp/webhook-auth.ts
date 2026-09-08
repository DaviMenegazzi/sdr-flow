import { createHmac, timingSafeEqual } from 'node:crypto';

export function secretMatches(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function verifyMetaSignature(rawBody: Buffer, signature: string | undefined, appSecret: string | undefined): boolean {
  if (!appSecret) return false;
  return secretMatches(signature, `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`);
}
