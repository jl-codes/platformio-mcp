import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import CommandLauncher from '../../../components/command-launcher';
import { mockFetch } from '../../mocks/apiHandlers';

describe('CommandLauncher', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      return { ok: true, json: async () => ({}) };
    });
  });

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    activeWorkspace: '/test/workspace',
    hardware: [],
    apiBase: 'http://localhost:8080',
    token: 'test-token'
  };

  it('contains "Check Project" and "Run Tests" in the dropdown', () => {
    render(<CommandLauncher {...defaultProps} />);
    
    const select = screen.getByRole('combobox'); // Note: there are multiple combos now (verb, env, port). But ACTION VERB is first or we can get by label.
    // Let's get by label text
    // The label is a span or label element? Let's query by display value or text.
    expect(screen.getByText('CHECK PROJECT (LINTING)')).toBeInTheDocument();
    expect(screen.getByText('RUN UNIT TESTS')).toBeInTheDocument();
  });

  it('fires a POST to /api/check when "Check Project" is selected and executed', async () => {
    render(<CommandLauncher {...defaultProps} />);
    
    const selects = screen.getAllByRole('combobox');
    const actionSelect = selects[0]; // ACTION VERB is the first select

    fireEvent.change(actionSelect, { target: { value: 'check' } });

    const btn = screen.getByRole('button', { name: /EXECUTE/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/check'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ projectDir: '/test/workspace' })
        })
      );
    });
  });

  it('fires a POST to /api/test when "Run Tests" is selected and executed', async () => {
    render(<CommandLauncher {...defaultProps} />);
    
    const selects = screen.getAllByRole('combobox');
    const actionSelect = selects[0]; // ACTION VERB is the first select

    fireEvent.change(actionSelect, { target: { value: 'test' } });

    const btn = screen.getByRole('button', { name: /EXECUTE/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/test'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ projectDir: '/test/workspace' })
        })
      );
    });
  });
});
