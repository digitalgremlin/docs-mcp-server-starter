import { describe, it, expect } from 'vitest';
import { LruCache } from '../src/cache.js';

describe('LruCache', () => {
  it('returns undefined for missing key', () => {
    const cache = new LruCache<string, number>(3);
    expect(cache.get('a')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    const cache = new LruCache<string, number>(3);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
  });

  it('evicts the least recently used entry when full', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('get() promotes the accessed key so it is not evicted next', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.has('b')).toBe(false);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('peek() reads without promoting', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.peek('a');
    cache.set('c', 3);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('updating an existing key does not grow the cache', () => {
    const cache = new LruCache<string, number>(3);
    cache.set('a', 1);
    cache.set('a', 2);
    expect(cache.size()).toBe(1);
    expect(cache.get('a')).toBe(2);
  });

  it('size() reflects current entry count', () => {
    const cache = new LruCache<string, number>(10);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size()).toBe(2);
  });

  it('has() returns false after eviction', () => {
    const cache = new LruCache<string, number>(1);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
  });
});
