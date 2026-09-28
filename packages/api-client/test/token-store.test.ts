import { describe, expect, it } from 'vitest';
import { createTokenStore } from '../src/token-store';
import { BrokenStorage, MemoryStorage } from './support';

const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

describe('createTokenStore', () => {
  it('keeps a token in memory when no storage is given', () => {
    const store = createTokenStore('afb.test');
    expect(store.get()).toBeNull();
    store.set('abc', FUTURE);
    expect(store.get()).toBe('abc');
    store.clear();
    expect(store.get()).toBeNull();
  });

  it('persists to storage so a reload (a new store) still sees the token', () => {
    const storage = new MemoryStorage();
    createTokenStore('afb.student.session', storage).set('abc', FUTURE);

    expect(JSON.parse(storage.getItem('afb.student.session')!)).toEqual({ token: 'abc', expiresAt: FUTURE });
    expect(createTokenStore('afb.student.session', storage).get()).toBe('abc');
    expect(createTokenStore('afb.faculty.session', storage).get()).toBeNull();
  });

  it('treats an expired token as absent', () => {
    const store = createTokenStore('k', new MemoryStorage());
    store.set('old', PAST);
    expect(store.get()).toBeNull();
  });

  it('uses the injected clock', () => {
    const store = createTokenStore('k', undefined, () => Date.parse('2030-01-01T00:00:00Z'));
    store.set('t', '2030-01-01T00:00:01Z');
    expect(store.get()).toBe('t');
  });

  it('ignores corrupted or malformed stored values', () => {
    const storage = new MemoryStorage();
    storage.setItem('k', '{not json');
    expect(createTokenStore('k', storage).get()).toBeNull();
    storage.setItem('k', JSON.stringify({ token: 42, expiresAt: FUTURE }));
    expect(createTokenStore('k', storage).get()).toBeNull();
  });

  it('falls back to memory when storage is blocked', () => {
    const store = createTokenStore('k', new BrokenStorage());
    store.set('abc', FUTURE);
    expect(store.get()).toBe('abc');
    expect(() => {
      store.clear();
    }).not.toThrow();
    expect(store.get()).toBeNull();
  });
});
