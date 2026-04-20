import React from 'react';

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
}

export default function HardwareRack({ hardware }: HardwareRackProps) {
  
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
            <div key={device.port + idx} className="hardware-item">
              {renderStatusPip(device.claim)}
              <div className="hardware-info">
                <span className="hardware-port">{device.port.split('/').pop() || device.port}</span>
                <span className="hardware-desc" title={`${device.description} (${device.hwid})`}>
                  {device.detectedBoard ? `board:${device.detectedBoard}` : device.description}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
