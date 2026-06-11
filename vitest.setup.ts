import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { Agent, setGlobalDispatcher } from 'undici';

// Disable keep-alive for tests to prevent ECONNRESET errors
// Use pipelining=0 instead of keepAlive=false for this version of undici
setGlobalDispatcher(new Agent({ pipelining: 0 }));

// Mock fetch globally for component tests, but not for server integration tests
if (!process.env.VITEST_SERVER_TEST) {
  global.fetch = vi.fn();
}

// Mock console.error to suppress error logs during tests
global.console.error = vi.fn();

// Mock window.getComputedStyle
Object.defineProperty(window, 'getComputedStyle', {
  value: () => ({
    getPropertyValue: () => '',
  }),
});

const createMemoryStorage = (): Storage => {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  };
};

const installMemoryStorage = (name: 'localStorage' | 'sessionStorage') => {
  const storage = createMemoryStorage();
  Object.defineProperty(window, name, {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: storage,
  });
};

installMemoryStorage('localStorage');
installMemoryStorage('sessionStorage');

// Global test utilities
export const mockFetch = (response: any, revisionsResponse?: any) => {
  (global.fetch as any).mockImplementation((url: string) => {
    // Handle /api/revisions endpoint
    if (url.includes('/api/revisions')) {
      return Promise.resolve({
        ok: revisionsResponse !== null,
        json: async () =>
          revisionsResponse ?? {
            specialOptions: [],
            branches: [],
            commits: [],
          },
      });
    }
    // Default: /api/diff and others
    return Promise.resolve({
      ok: true,
      json: async () => response,
      blob: async () => ({ size: 1024 }),
    });
  });
};

export const mockFetchError = (error: string) => {
  (global.fetch as any).mockRejectedValue(new Error(error));
};
