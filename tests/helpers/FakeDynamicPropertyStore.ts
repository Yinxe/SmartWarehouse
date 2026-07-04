export class FakeDynamicPropertyStore {
  readonly values = new Map<string, string | undefined>();

  getJson<T>(key: string, fallback: T): T {
    const raw = this.values.get(key);
    if (typeof raw !== "string") return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  setJson(key: string, value: unknown): void {
    this.values.set(key, JSON.stringify(value));
  }

  delete(key: string): void {
    this.values.delete(key);
  }
}
