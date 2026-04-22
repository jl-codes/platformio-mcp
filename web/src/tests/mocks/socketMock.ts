import { vi } from 'vitest';

type EventHandler = (...args: any[]) => void;

class SocketMock {
  public listeners: Record<string, EventHandler[]> = {};

  on(eventName: string, handler: EventHandler) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(handler);
    return this; // For chaining
  }

  off(eventName: string, handler?: EventHandler) {
    if (!this.listeners[eventName]) return this;
    if (handler) {
      this.listeners[eventName] = this.listeners[eventName].filter((h) => h !== handler);
    } else {
      this.listeners[eventName] = [];
    }
    return this;
  }

  emit(eventName: string, ...args: any[]) {
    // Client-side emit mock if needed
  }

  disconnect() {
    this.listeners = {};
  }

  // Custom helper for tests to simulate server pushing data
  emitFromServer(eventName: string, ...args: any[]) {
    if (this.listeners[eventName]) {
      this.listeners[eventName].forEach((handler) => handler(...args));
    }
  }
}

// Singleton instance to be controlled from tests
export const mockSocketInstance = new SocketMock();

export const io = vi.fn(() => mockSocketInstance);
