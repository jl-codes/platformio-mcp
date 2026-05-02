import React, { useEffect, useRef } from 'react';
import { LogEvent, SpoolerState, LockState } from '../App.js';

interface SerialLogProps {
  logs: Record<string, LogEvent[]>;
  spoolerStates: Record<string, SpoolerState>;
  activeWorkspace: string | null;
  lockState: LockState;
}

export default function SerialLog({ logs, spoolerStates, lockState }: SerialLogProps) {
  const streamRef = useRef<HTMLDivElement>(null);
  
  // Aggregate all logs roughly to show in one stream for now
  const allLogs = Object.values(logs).flat().sort((a, b) => a.timestamp - b.timestamp);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <aside className="serial-telemetry">
      <div className="telemetry-header">
        <h3 className="mono-label">SERIAL_TELEMETRY</h3>
        {lockState.isLocked && (
          <span className="mono-label" style={{ color: 'var(--error)' }}>[ PORT_LOCKED ]</span>
        )}
      </div>
      
      <div className="telemetry-grid">
        <div className="stat-box">
          <p className="mono-label">Active Ports</p>
          <p className="stat-value">{Object.keys(spoolerStates).length}</p>
        </div>
        <div className="stat-box">
          <p className="mono-label">Data Packets</p>
          <p className="stat-value">{allLogs.length}</p>
        </div>
      </div>

      <div className="serial-stream" ref={streamRef}>
        {allLogs.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
            No serial stream detected...
          </div>
        ) : (
          allLogs.map((log, index) => (
            <p key={index} className="rx-line" style={{ marginBottom: '4px' }}>
              <span style={{ opacity: 0.5, marginRight: '8px' }}>[{log.port?.split('/').pop()}]</span>
              <span style={{ color: 'var(--on-surface)', whiteSpace: 'pre-wrap' }}>{log.data}</span>
            </p>
          ))
        )}
      </div>
    </aside>
  );
}
