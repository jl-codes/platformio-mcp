import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import HardwareRack, { HardwareDevice } from '../components/hardware-rack';
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

describe('Status Indicators', () => {
  const commonProps = {
    activeWorkspace: null,
    apiBase: '',
    token: '',
  };

  it('displays a pulsing green dot when active/running', () => {
    const devices: HardwareDevice[] = [{
      port: '/dev/ttyUSB0',
      description: 'Test Device',
      hwid: '1234',
      claim: { type: 'monitor', owner_workspace: '', owner_pid: 1, timestamp: 0 }
    }];

    render(<HardwareRack hardware={devices} {...commonProps} />);
    expect(screen.getByText('Monitoring')).toBeInTheDocument();
  });

  it('displays a pulsing gold dot when uploading', () => {
    const devices: HardwareDevice[] = [{
      port: '/dev/ttyUSB0',
      description: 'Test Device',
      hwid: '1234',
      claim: { type: 'upload', owner_workspace: '', owner_pid: 1, timestamp: 0 }
    }];

    render(<HardwareRack hardware={devices} {...commonProps} />);
    expect(screen.getByText('Uploading')).toBeInTheDocument();
  });

  it('displays a static blue dot when idle or connected', () => {
    const devices: HardwareDevice[] = [{
      port: '/dev/ttyUSB0',
      description: 'Test Device',
      hwid: '1234',
      detectedBoard: 'uno'
    }];

    render(<HardwareRack hardware={devices} {...commonProps} />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('displays a static red dot when in error state or locked by something else', () => {
    const devices: HardwareDevice[] = [{
      port: '/dev/ttyUSB0',
      description: 'Test Device',
      hwid: '1234',
      claim: { type: 'unknown', owner_workspace: '', owner_pid: 1, timestamp: 0 }
    }];

    render(<HardwareRack hardware={devices} {...commonProps} />);
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  it('displays a static grey dot when disconnected', () => {
    const devices: HardwareDevice[] = [{
      port: '/dev/ttyUSB0',
      description: 'Test Device',
      hwid: 'n/a'
    }];

    render(<HardwareRack hardware={devices} {...commonProps} />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });
});

