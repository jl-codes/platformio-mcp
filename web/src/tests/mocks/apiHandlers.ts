import { vi } from 'vitest';

export const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const urlString = typeof input === 'string' ? input : input.toString();

  // Handle mock responses based on urlString
  if (urlString.includes('/api/history/')) {
    const idMatch = urlString.match(/\/api\/history\/([^/]+)/);
    const id = idMatch ? idMatch[1] : 'mock-id';
    
    // Return a simulated ArtifactRecord JSON
    return {
      ok: true,
      json: async () => ({
        id,
        type: 'build',
        status: 'success',
        timestamp: Date.now(),
        duration: 1000,
        logPath: `/path/to/mock/logs/${id}.log`,
        env: 'native'
      })
    };
  }

  // Default mock response for other endpoints
  return {
    ok: true,
    json: async () => ({})
  };
});
