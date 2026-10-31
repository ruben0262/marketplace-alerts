import { randomBytes, createHash, scrypt, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, key] = (stored || '').split(':');
  if (!salt || !key) return false;
  const actual = await derive(password, salt, 64);
  const expected = Buffer.from(key, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function vault(hexKey) {
  if (!/^[a-f\d]{64}$/i.test(hexKey || '')) throw new Error('ENCRYPTION_KEY must be 32 random bytes encoded as hex.');
  const key = Buffer.from(hexKey, 'hex');
  return {
    seal(value) {
      if (!value) return null;
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString('base64')).join('.');
    },
    open(value) {
      if (!value) return '';
      const [iv, tag, ciphertext] = value.split('.').map(v => Buffer.from(v, 'base64'));
      const cipher = createDecipheriv('aes-256-gcm', key, iv);
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8');
    },
  };
}
