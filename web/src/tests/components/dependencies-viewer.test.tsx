import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import DependenciesViewer from '../../../components/dependencies-viewer';
import { mockFetch } from '../../mocks/apiHandlers';

describe('DependenciesViewer', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    // Setup default fetch mock for this test
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/libraries/installed')) {
        return {
          ok: true,
          json: async () => [{ name: 'TestLib', description: 'A test library', version: '1.0.0' }]
        };
      }
      return { ok: true, json: async () => ({}) };
    });
  });

  const defaultProps = {
    apiBase: 'http://localhost:8080',
    token: 'test-token',
    activeWorkspace: '/test/workspace',
    lockState: { isLocked: false }
  };

  it('renders correctly and asserts no search/install mutation inputs', async () => {
    render(<DependenciesViewer {...defaultProps} />);
    
    // Check if the title is there
    expect(screen.getByText('DEPENDENCIES VIEWER')).toBeInTheDocument();
    
    // Check that there are no inputs
    const inputs = screen.queryAllByRole('textbox');
    expect(inputs.length).toBe(0);

    // Wait for the library to be rendered
    await waitFor(() => {
      expect(screen.getByText('TestLib')).toBeInTheDocument();
    });
  });

  it('validates the "Manage in PIO Home" button dispatches a POST to /api/spooler/start', async () => {
    render(<DependenciesViewer {...defaultProps} />);
    
    const btn = screen.getByRole('button', { name: /MANAGE IN PIO HOME/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/spooler/start'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ command: 'pio home', projectDir: '/test/workspace' })
        })
      );
    });
  });
});
