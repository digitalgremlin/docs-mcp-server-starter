export class LruCache<K, V> {
  private readonly maxSize: number;
  private readonly map: Map<K, V>;

  constructor(maxSize: number) {
    if (maxSize < 1) throw new Error('maxSize must be >= 1');
    this.maxSize = maxSize;
    this.map = new Map();
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value as K;
      this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  size(): number {
    return this.map.size;
  }
}
