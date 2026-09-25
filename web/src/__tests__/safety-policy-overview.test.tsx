import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SafetyPolicyOverview from '../components/safety-policy-overview';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
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

describe('SafetyPolicyOverview', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('reports unenrolled lab-runner authority and preserves write budgets when resetting monitor state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true }),
    });
    const onActionComplete = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SafetyPolicyOverview
        apiBase="http://127.0.0.1:3001"
        token="dashboard-token"
        loading={false}
        onActionComplete={onActionComplete}
        payload={{
          projectDir: '/demo/project',
          policy: {
            profile: 'lab_runner',
            projectEnrollment: {enrolled:false, digest:'fixture'},
            source: 'project',
            approvalRequiredOperations: [],
            deniedOperations: [],
          },
          pendingApprovals: [],
          automationStates: [{
            automationKey: 'nightly-hil',
            state: 'binding_expired',
            lastStatus: 'failed',
            consecutiveFailures: 2,
            consecutiveHardwareWrites: 1,
            environment: 'esp32dev',
            updatedAt: new Date().toISOString(),
          }],
          activeMonitors: [],
          recentAuditEvents: [],
          deviceLocks: [],
          recentDiagnostics: [],
          rawLogLinks: [],
        }}
      />,
    );

    expect(screen.queryByText('LAB-RUNNER PREAUTHORIZED')).not.toBeInTheDocument();
    expect(screen.getByText(/not enrolled; operator baseline applies/)).toBeInTheDocument();
    expect(screen.getByText(/Host permissions are enforced externally/)).toBeInTheDocument();
    expect(screen.getByText('nightly-hil')).toBeInTheDocument();
    expect(screen.getByText(/1 protected hardware writes/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reset cursor/i }));
    const resetButtons = await screen.findAllByRole('button', { name: /reset cursor/i });
    fireEvent.click(resetButtons[resetButtons.length - 1]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:3001/api/safety/automations/nightly-hil/clear',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ projectDir: '/demo/project' }),
        }),
      );
      expect(onActionComplete).toHaveBeenCalled();
    });
  });
});
