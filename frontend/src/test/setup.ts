/**
 * Vitest setup file — runs before every test file.
 *
 * Provides:
 *   1. An InMemoryStorage shim for `localStorage` / `sessionStorage`.
 *      Workaround: Node 22+ exposes an experimental `localStorage` global
 *      that jsdom 23 detects and does NOT override; the result is a no-op
 *      `window.localStorage` with no methods. This replaces it.
 *   2. Automatic DOM cleanup after each test (@testing-library/react does
 *      NOT register its auto-cleanup with vitest by default like it does
 *      with jest, so consecutive renders in the same file stack up unless
 *      we call cleanup() here).
 */
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

class InMemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

// Replace both the window-scoped and global localStorage with a working impl.
Object.defineProperty(window, "localStorage", {
  value: new InMemoryStorage(),
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "localStorage", {
  value: window.localStorage,
  configurable: true,
  writable: true,
});

// Also provide sessionStorage for completeness.
Object.defineProperty(window, "sessionStorage", {
  value: new InMemoryStorage(),
  configurable: true,
  writable: true,
});

// Register DOM cleanup after every test — testing-library@14 with vitest
// does not auto-cleanup like it does with jest.
afterEach(() => {
  cleanup();
});
