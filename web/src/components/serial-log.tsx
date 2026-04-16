/**
 * Serial Log Component
 * Tails real-time TTY diagnostic streams.
 *
 * Provides:
 * - SerialLog: React Component
 */
import React, { useEffect, useRef, useState } from 'react';
import { LogEvent, SpoolerState, LockState } from '../app.js';

interface Props {
  logs: Record<string, LogEvent[]>;
  spoolerStates: Record<string, SpoolerState>;
  activeWorkspace?: string | null;
  lockState?: LockState;
}

const SerialLog: React.FC<Props> = ({ logs, spoolerStates, activeWorkspace, lockState }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [availablePorts, setAvailablePorts] = useState<{ port: string; description: string }[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>('');
  const [pendingPort, setPendingPort] = useState<string>('');
  const [isAutoScrollFastened, setIsAutoScrollFastened] = useState(true);

  const activePorts = Object.keys(spoolerStates);

  const isValidDevice = (device: { port: string; description: string }) => {
    const port = device.port.toLowerCase();
    const desc = device.description?.toLowerCase() || '';
    return (
      !port.includes('bluetooth') && 
      !port.includes('blth') && 
      desc !== 'n/a' && 
      desc !== ''
    );
  };

  const fetchDevices = async () => {
    try {
      const token = new URLSearchParams(window.location.search).get('token') || '';
      const res = await fetch('/api/devices', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setAvailablePorts(data);
      
      // Smart Auto-focus: prioritize valid hardware over system/virtual ports
      if (!selectedTab && data.length > 0) {
        const firstValid = data.find(isValidDevice);
        if (firstValid) {
          setSelectedTab(firstValid.port);
        }
      }
    } catch (e) {
      console.error('Failed to fetch devices', e);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  // Synchronize UI selection with external spooler changes (MCP commands)
  useEffect(() => {
    // Scenario 1: Tab Opening (External Start)
    // If we have active ports but nothing selected, snap to the first one
    if (activePorts.length > 0 && !selectedTab) {
      setSelectedTab(activePorts[0]);
    }

    // Scenario 2: Tab Shutting (External Stop)
    // If our current selection is no longer in the active list, we must switch or clear
    if (selectedTab && !activePorts.includes(selectedTab)) {
      if (activePorts.length > 0) {
        setSelectedTab(activePorts[0]); // Switch to next available
      } else {
        setSelectedTab(''); // Return to Empty State Launcher
      }
    }
  }, [activePorts, selectedTab]);

  useEffect(() => {
    if (isAutoScrollFastened && bottomRef.current) {
      bottomRef.current.scrollIntoView();
    }
  }, [logs, selectedTab, isAutoScrollFastened]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const atBottom = scrollHeight - scrollTop - clientHeight < 150;
    setIsAutoScrollFastened(atBottom);
  };

  const handleStart = async (portToStart: string) => {
    try {
      const token = new URLSearchParams(window.location.search).get('token') || '';
      const res = await fetch('/api/spooler/start', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          port: portToStart, 
          autoReconnect: true,
          projectDir: activeWorkspace ?? undefined
        })
      });
      if (!res.ok) {
        const data = await res.json();
        alert(`Could not start spooler: ${data.error || res.statusText}`);
      } else {
        setSelectedTab(portToStart);
      }
    } catch (e) {
      console.error('Failed to start spooling', e);
    }
  };

  const handleStop = async (portToStop: string) => {
    try {
      const token = new URLSearchParams(window.location.search).get('token') || '';
      await fetch('/api/spooler/stop', { 
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ port: portToStop })
      });
    } catch (e) {
      console.error('Failed to stop spooling', e);
    }
  };

  const currentStatus = selectedTab ? spoolerStates[selectedTab] : null;
  const currentLogs = selectedTab ? (logs[selectedTab] || []) : [];

  return (
    <div className="panel serial-panel">
      <div className="serial-tabs">
        {activePorts.map(port => (
          <div 
            key={port} 
            className={`serial-tab ${selectedTab === port ? 'active' : ''} ${spoolerStates[port].status?.toLowerCase()}`}
            onClick={() => setSelectedTab(port)}
          >
            <span className="tab-status-dot"></span>
            <span className="tab-label">{port.split('/').pop()}</span>
            <button className="tab-close" onClick={(e) => { e.stopPropagation(); handleStop(port); }}>×</button>
          </div>
        ))}
        <div className="tab-adder">
          <select 
            value={pendingPort} 
            onChange={e => {
              if (e.target.value) {
                handleStart(e.target.value);
              }
            }}
            className="adder-select"
          >
            <option value="">+</option>
            {availablePorts.filter(p => !activePorts.includes(p.port)).map(p => (
              <option key={p.port} value={p.port}>{p.description || p.port}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel-header dark-alt" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-light)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div className={`status-badge-inline ${currentStatus?.status?.toLowerCase() || 'idle'}`}>
            <span className="dot"></span>
            {currentStatus?.status || 'Idle'}
          </div>
        </div>
        
        <div className="spooler-controls" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          {currentStatus?.active && (
             <button onClick={() => handleStop(selectedTab)} className="btn-stop">Stop Session</button>
          )}
          <button onClick={fetchDevices} className="btn-refresh" title="Refresh Devices">🔄</button>
        </div>
      </div>

      <div className="panel-content serial-content scrollable" onScroll={handleScroll}>
        {activePorts.length === 0 ? (
          <div className="empty-state-launcher">
            <div className="launcher-icon">🔌</div>
            <h3>No Active Port Monitor</h3>
            <p>Select a device to start real-time logging</p>
            <select 
              value="" 
              onChange={e => {
                if (e.target.value) handleStart(e.target.value);
              }}
              className="launcher-select"
            >
              <option value="">Select a port...</option>
              {availablePorts.map(p => (
                <option key={p.port} value={p.port}>{p.description || p.port}</option>
              ))}
            </select>
            <button onClick={fetchDevices} className="launcher-refresh">Refresh Device List</button>
          </div>
        ) : (
          <div className="serial-lines">
            {!selectedTab ? (
               <div className="empty-state">Select a tab to view logs</div>
            ) : currentLogs.length === 0 ? (
               <div className="empty-state">Waiting for data on {selectedTab}...</div>
            ) : (
              currentLogs.map((log, i) => (
                <div key={i} className="serial-line">
                  <span className="log-prefix">[{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}]</span>
                  <span className="log-text">{log.data}</span>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      {currentStatus?.logFile && (
        <div className="serial-footer">
          <span className="footer-label">Logging to:</span>
          <span className="footer-value" title={currentStatus.logFile}>{currentStatus.logFile}</span>
        </div>
      )}
    </div>
  );
};

export default SerialLog;
