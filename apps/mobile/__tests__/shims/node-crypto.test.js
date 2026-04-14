import crypto, { createHash } from '../../shims/node-crypto';

describe('node-crypto shim', () => {
  test('createHash returns a Hash with update and digest', () => {
    const hash = createHash('sha256');
    expect(typeof hash.update).toBe('function');
    expect(typeof hash.digest).toBe('function');
  });

  test('sha256 produces correct digest for known input', () => {
    const result = createHash('sha256').update('hello').digest();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(32);
    const hex = [...result].map(b => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  test('sha512 produces correct digest', () => {
    const result = createHash('sha512').update('hello').digest();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(64);
  });

  test('algorithm is case-insensitive', () => {
    const lower = createHash('sha256').update('test').digest();
    const upper = createHash('SHA256').update('test').digest();
    expect(lower).toEqual(upper);
  });

  test('accepts sha-256 form', () => {
    const dashed = createHash('sha-256').update('test').digest();
    const plain = createHash('sha256').update('test').digest();
    expect(dashed).toEqual(plain);
  });

  test('update is chainable', () => {
    const hash = createHash('sha256');
    expect(hash.update('hello')).toBe(hash);
  });

  test('multiple updates produce same result as single update', () => {
    const single = createHash('sha256').update('helloworld').digest();
    const multi = createHash('sha256').update('hello').update('world').digest();
    expect(multi).toEqual(single);
  });

  test('update accepts Uint8Array', () => {
    const data = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    const fromBytes = createHash('sha256').update(data).digest();
    const fromString = createHash('sha256').update('hello').digest();
    expect(fromBytes).toEqual(fromString);
  });

  test('throws for unsupported algorithm', () => {
    expect(() => createHash('md5')).toThrow('Unsupported hash algorithm: md5');
  });

  test('default export has createHash', () => {
    expect(crypto.createHash).toBe(createHash);
  });
});
