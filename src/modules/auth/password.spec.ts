import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies the correct password and rejects another one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
    expect(hash.length).toBeLessThan(255);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(
      true,
    );
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('uses a unique salt for each password hash', async () => {
    const first = await hashPassword('same password');
    const second = await hashPassword('same password');
    expect(first).not.toBe(second);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('password', 'invalid')).toBe(false);
  });
});
