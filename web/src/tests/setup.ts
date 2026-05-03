import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { mockFetch } from './mocks/apiHandlers';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverMock as any;

// Mock socket.io-client
vi.mock('socket.io-client', async () => {
  const { io } = await import('./mocks/socketMock');
  return {
    default: io,
    io: io
  };
});

// Mock global fetch
global.fetch = mockFetch as unknown as typeof fetch;

// Blank window.matchMedia mock
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
