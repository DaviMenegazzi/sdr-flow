import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function getDerivedKey(customSecret?: string): Buffer {
  const source = customSecret || process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!source) throw new Error('Configure ENCRYPTION_KEY antes de salvar credenciais.');
  return crypto.createHash('sha256').update(source).digest();
}

/**
 * Criptografa objeto JSON em repouso usando AES-256-GCM com IV aleatório e Authentication Tag.
 * Retorna string no formato iv:tag:encryptedData em hexadecimal.
 */
export function encryptCredentials(data: Record<string, unknown>, secretKey?: string): string {
  const key = getDerivedKey(secretKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const jsonStr = JSON.stringify(data);
  let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decifra credenciais a partir de ciphertext criptografado com AES-256-GCM.
 */
export function decryptCredentials<T = Record<string, unknown>>(ciphertext: string, secretKey?: string): T {
  const parts = ciphertext.split(':');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('Formato inválido de credenciais criptografadas.');
  }

  const ivHex = parts[0];
  const tagHex = parts[1];
  const encryptedHex = parts[2];
  const key = getDerivedKey(secretKey);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = decipher.update(encryptedHex, 'hex', 'utf8') + decipher.final('utf8');

  return JSON.parse(decrypted) as T;
}

/**
 * Mascara strings sensíveis (tokens, chaves) para que nunca sejam devolvidas por inteiro ao frontend.
 */
export function maskSecret(secret: string | null | undefined): string {
  if (!secret) return '';
  const trimmed = secret.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}
