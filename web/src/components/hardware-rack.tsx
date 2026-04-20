import React, { useState } from 'react';

interface PortClaim {
  type: string;
  owner_workspace: string;
  owner_pid: number;
  timestamp: number;
}

export interface HardwareDevice {
  port: string;
  description: string;
  hwid: string;
  detectedBoard?: string;
  claim?: PortClaim;
}

interface HardwareRackProps {
  hardware: HardwareDevice[];
  activeWorkspace: string | null;
  apiBase: string;
  token: string;
}

export default function HardwareRack({ hardware, activeWorkspace, apiBase, token }: HardwareRackProps) {
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});

  const toggleMonitor = async (device: HardwareDevice) => {
    const isMonitoring = device.claim?.type === 'monitor';
    const port = device.port;
    const endpoint = isMonitoring ? '/api/spooler/stop' : '/api/spooler/start';
    
    setLoadingMap(prev => ({ ...prev, [port]: true }));
    try {
      await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ port, projectDir: activeWorkspace })
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMap(prev => ({ ...prev, [port]: false }));
    }
  };

  const renderStatusPip = (claim?: PortClaim) => {
    if (!claim) return <div className="hardware-pip idle" title="Idle" />;
    if (claim.type === 'monitor') {
      return (
        <div 
          className="hardware-pip monitor" 
          title={`Monitor Claimed (PID: ${claim.owner_pid}) - Workspace: ${claim.owner_workspace.split('/').pop()}`} 
        />
      );
    }
    return (
      <div 
        className="hardware-pip upload" 
        title={`Upload Claimed (PID: ${claim.owner_pid}) - Workspace: ${claim.owner_workspace.split('/').pop()}`} 
      />
    );
  };

  return (
    <div className="hardware-rack">
      <div className="global-divider">
        <div className="divider-line"></div>
        <span className="divider-text">SYSTEM GLOBAL LAYER</span>
        <div className="divider-line"></div>
      </div>
      <header style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
        <h3 className="mono-label">HARDWARE_RACK</h3>
        <span className="global-badge">SYS</span>
      </header>
      
      <div className="hardware-list">
        {hardware.length === 0 ? (
          <div className="mono-label" style={{ textAlign: 'center', margin: '20px 0' }}>No Devices Detected</div>
        ) : (
          hardware.map((device, idx) => (
            <div key={device.port + idx} className="hardware-item hover-container" style={{ position: 'relative' }}>
              {renderStatusPip(device.claim)}
              <div className="hardware-info">
                <span className="hardware-port">{device.port.split('/').pop() || device.port}</span>
                <span className="hardware-desc" title={`${device.description} (${device.hwid})`}>
                  {device.detectedBoard ? `board:${device.detectedBoard}` : device.description}
                </span>
              </div>
              
              <button 
                onClick={() => toggleMonitor(device)}
                disabled={loadingMap[device.port] || (device.claim && device.claim.type !== 'monitor')}
                className="rack-btn"
                style={{
                  background: 'transparent', border: 'none', color: device.claim?.type === 'monitor' ? 'var(--error)' : 'var(--secondary)', 
                  cursor: 'pointer', padding: '4px', opacity: (loadingMap[device.port] || device.claim?.type === 'monitor') ? 1 : 0.4,
                }}
                title={device.claim?.type === 'monitor' ? 'Kill Monitor' : 'Start Monitor'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                  {device.claim?.type === 'monitor' ? 'stop_circle' : 'play_circle'}
                </span>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
