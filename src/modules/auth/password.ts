import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const COST = 16384;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: COST, r: 8, p: 1 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${COST}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const match = /^scrypt\$16384\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(
    encoded,
  );
  if (!match) return false;
  const salt = Buffer.from(match[1], 'hex');
  const expected = Buffer.from(match[2], 'hex');
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}
