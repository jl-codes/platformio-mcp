import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CommandFeed, { CommandRecord } from '../components/command-feed';
import React from 'react';

// Mock matchMedia for antd
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('CommandFeed Component', () => {
  const mockOnOpenTab = vi.fn();

  it('renders MCP Layer correctly', async () => {
    const commands: CommandRecord[] = [{
      id: 'test-uuid-1234',
      commandDesc: 'test-command',
      timestamp: Date.now(),
      status: 'success',
      tasks: [],
      mcpToolName: 'build_project',
      mcpRequest: { projectDir: '/tmp' },
      mcpResponse: { status: 'ok' },
      source: 'agent'
    }];

    render(<CommandFeed commands={commands} onOpenTab={mockOnOpenTab} activeTabRef={null} />);
    
    // Expand panel
    fireEvent.click(screen.getByText('Build Project'));
    
    // Check that MCP LAYER header exists
    expect(await screen.findAllByText('MCP LAYER')).toHaveLength(1);
    
    // Check UUID
    expect(screen.getByText('test-uuid-1234')).toBeInTheDocument();
  });

  it('renders OS/Hardware Layer correctly underneath MCP layer', async () => {
    const commands: CommandRecord[] = [{
      id: 'test-uuid-5678',
      commandDesc: 'test-command',
      timestamp: Date.now(),
      status: 'success',
      mcpToolName: 'upload_firmware',
      tasks: [{
        taskId: 'task-1',
        type: 'upload',
        status: 'success',
        pid: 9999,
        exitCode: 0,
        port: '/dev/cu.usbserial'
      }]
    }];

    render(<CommandFeed commands={commands} onOpenTab={mockOnOpenTab} activeTabRef={null} />);
    
    // Expand panel
    fireEvent.click(screen.getByText('Upload Firmware'));
    
    // Check that OS/Hardware Layer header exists
    const osHeaders = await screen.findAllByText('OS / HARDWARE LAYER');
    expect(osHeaders.length).toBeGreaterThan(0);
    
    // Check PID
    expect(screen.getByText('9999')).toBeInTheDocument();
    
    // Check Log Reference (port)
    expect(screen.getByText('/dev/cu.usbserial')).toBeInTheDocument();
  });

  it('gracefully falls back to commandDesc when mcpToolName is missing', async () => {
    const commands: CommandRecord[] = [{
      id: 'legacy-uuid',
      commandDesc: 'Legacy PIO Command',
      timestamp: Date.now(),
      status: 'success',
      tasks: [],
      source: 'dashboard'
      // No mcpToolName, mcpRequest, mcpResponse
    }];

    render(<CommandFeed commands={commands} onOpenTab={mockOnOpenTab} activeTabRef={null} />);
    
    expect(screen.getAllByText('Legacy Execution').length).toBeGreaterThan(0);
  });
});
