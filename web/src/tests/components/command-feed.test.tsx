import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../../../app';
import { mockFetch } from '../../mocks/apiHandlers';
import { mockSocketInstance } from '../../mocks/socketMock';
import CommandFeed, { CommandRecord } from '../../../components/command-feed';

describe('CommandFeed & Telemetry Integration', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockSocketInstance.disconnect();
    
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/hardware')) return { ok: true, json: async () => [] };
      if (url.includes('/api/commands')) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'cmd-history-1',
              commandDesc: 'Run Check',
              timestamp: Date.now() - 10000,
              status: 'success',
              artifacts: [{ id: 'art-history-1', type: 'check', status: 'success' }]
            }
          ])
        };
      }
      return { ok: true, json: async () => ({}), text: async () => 'mock log content' };
    });
  });

  it('renders "Check" and "Test" type commands with distinct visual iconography in CommandFeed', () => {
    const mockOnOpenTab = vi.fn();
    const commands: CommandRecord[] = [
      {
        id: 'cmd-1',
        commandDesc: 'Run Check',
        timestamp: Date.now(),
        status: 'running',
        artifacts: [{ id: 'art-1', type: 'check', status: 'running' }]
      },
      {
        id: 'cmd-2',
        commandDesc: 'Run Test',
        timestamp: Date.now() - 1000,
        status: 'success',
        artifacts: [{ id: 'art-2', type: 'test', status: 'success' }]
      }
    ];

    render(<CommandFeed commands={commands} onOpenTab={mockOnOpenTab} activeTabRef={null} />);
    
    // Icon checks
    expect(screen.getByText('fact_check')).toBeInTheDocument();
    expect(screen.getByText('science')).toBeInTheDocument();
    
    // Label checks
    expect(screen.getByText('[ CHECK ]')).toBeInTheDocument();
    expect(screen.getByText('[ TEST ]')).toBeInTheDocument();
  });

  it('tests UUID routing mapping: ensures concurrent log streams isolate properly', async () => {
    render(<App />);

    // Wait for initial render to settle
    await waitFor(() => {
      expect(screen.getByText('SERVER: OFFLINE')).toBeInTheDocument();
    });

    // Simulate two concurrent live build commands
    mockSocketInstance.emitFromServer('command_history_updated', { projectDir: '/workspace' });
    
    // We emit build logs for two different artifacts
    mockSocketInstance.emitFromServer('build_log', {
      timestamp: Date.now(),
      artifactId: 'uuid-1',
      logLine: 'Log for UUID 1'
    });

    mockSocketInstance.emitFromServer('build_log', {
      timestamp: Date.now(),
      artifactId: 'uuid-2',
      logLine: 'Log for UUID 2'
    });

    // Since we don't know exactly how they appear without opening the tab, let's open the tab for 'uuid-1'
    // To do this, we need 'uuid-1' to exist in the commands list.
    // Let's modify the mock to return these live commands
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/commands')) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'cmd-live-1',
              commandDesc: 'Build 1',
              timestamp: Date.now(),
              status: 'running',
              artifacts: [{ id: 'uuid-1', type: 'build', status: 'running' }]
            },
            {
              id: 'cmd-live-2',
              commandDesc: 'Build 2',
              timestamp: Date.now(),
              status: 'running',
              artifacts: [{ id: 'uuid-2', type: 'build', status: 'running' }]
            }
          ])
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    // Force refresh commands
    mockSocketInstance.emitFromServer('command_history_updated', { projectDir: '/workspace' });

    // Wait for the commands to appear in the UI
    await waitFor(() => {
      expect(screen.getByText(/#cmd-li.*Build 1/)).toBeInTheDocument();
      expect(screen.getByText(/#cmd-li.*Build 2/)).toBeInTheDocument();
    });

    // Click on uuid-1 tab in the feed
    const uuid1Elements = screen.getAllByText('[ BUILD ]');
    fireEvent.click(uuid1Elements[0]);

    // Check that Log for UUID 1 is visible
    await waitFor(() => {
      expect(screen.getByText('>')).toBeInTheDocument();
      // The innerHTML check might be tricky, let's query the terminal text
      const termLine = screen.getByText('Log for UUID 1');
      expect(termLine).toBeInTheDocument();
    });

    // Ensure UUID 2 log is NOT visible in UUID 1's tab
    expect(screen.queryByText('Log for UUID 2')).not.toBeInTheDocument();

    // Now click on uuid-2
    fireEvent.click(uuid1Elements[1]);

    await waitFor(() => {
      const termLine2 = screen.getByText('Log for UUID 2');
      expect(termLine2).toBeInTheDocument();
    });

    // Ensure UUID 1 log is NOT visible in UUID 2's tab
    expect(screen.queryByText('Log for UUID 1')).not.toBeInTheDocument();
  });

  it('tests Spooler Hydration: mock click on historical feed block calls mock fetch', async () => {
    render(<App />);

    // Wait for the historical command to appear
    await waitFor(() => {
      expect(screen.getByText(/#cmd-hi.*Run Check/)).toBeInTheDocument();
    });

    // Find the historical artifact block (which should be CHECK type)
    const checkBlock = screen.getByText('[ CHECK ]').closest('.command-item');
    expect(checkBlock).not.toBeNull();
    
    // Click it to trigger tab opening and log fetching
    fireEvent.click(checkBlock!);

    // Verify mockFetch was called to load historical data
    await waitFor(() => {
      // It might be calling /api/history/art-history-1/log or /api/logs?commandId=cmd-history-1&artifactId=art-history-1
      // We will assert it called fetch with the artifact ID
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/(history|logs).*art-history-1/),
        expect.anything()
      );
    });
  });
});
