import React from 'react';

import { TabRef } from '../App.js';

export interface ArtifactRecord {
  id: string; // Internal trace ID
  type: "build" | "monitor" | "upload";
  status: "inactive" | "running" | "success" | "error" | "terminated";
  logFile?: string;
  port?: string;
}

export interface CommandRecord {
  id: string;
  commandDesc: string;
  timestamp: number;
  status: "running" | "success" | "error" | "terminated";
  artifacts: ArtifactRecord[];
}

interface CommandFeedProps {
  commands: CommandRecord[];
  onOpenTab: (tab: TabRef) => void;
  activeTabRef: TabRef | null;
}

export default function CommandFeed({ commands, onOpenTab, activeTabRef }: CommandFeedProps) {
  
  const renderStatus = (status: string) => {
    switch (status) {
      case 'running': return 'ACTIVE';
      case 'success': return 'SUCCESS';
      case 'error': return 'FAILED';
      case 'terminated': return 'TERMINATED';
      default: return 'UNKNOWN';
    }
  }

  const liveCommands = commands.filter(c => c.status === 'running');
  const historicalCommands = commands.filter(c => c.status !== 'running').reverse();

  return (
    <aside className="command-feed">
      <header style={{ marginBottom: '24px' }}>
        <h3 className="mono-label" style={{ opacity: 0.7 }}>COMMAND_ACTION_FEED</h3>
      </header>
      
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {commands.length === 0 ? (
          <div className="mono-label" style={{ textAlign: 'center', marginTop: '20px' }}>Waiting for tasks...</div>
        ) : (
          <>
            {/* LIVE COMMANDS BLOCK */}
            {liveCommands.length > 0 && (
              <div style={{ marginBottom: '32px' }}>
                <div className="mono-label" style={{ marginBottom: '12px', color: 'var(--secondary)' }}>[ LIVE_TRACES ]</div>
                {liveCommands.map((cmd) => (
                  <div key={cmd.id} style={{ marginBottom: '16px' }}>
                    <div className="command-info" style={{ marginBottom: '8px' }}>
                      <span className="command-name" style={{ color: 'var(--secondary)' }}>
                        #{cmd.id.slice(0, 6)} - {cmd.commandDesc || 'PIO Task'}
                      </span>
                    </div>
                    <div style={{ paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {cmd.artifacts?.map(art => {
                        const isActive = activeTabRef?.artifactId === art.id;
                        return (
                          <div 
                            key={art.id}
                            className={`command-item ${isActive ? 'active-historical' : ''}`}
                            onClick={() => onOpenTab({ commandId: cmd.id, artifactId: art.id })}
                            style={{ cursor: 'pointer', margin: 0 }}
                          >
                            <div className={`command-dot ${art.status}`}></div>
                            <div className="command-info">
                              <span className="command-name" style={{ color: 'var(--secondary)', fontSize: '11px' }}>
                                [ {art.type === 'monitor' ? `Serial: ${art.port?.split('/').pop()}` : art.type.toUpperCase()} ]
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* HISTORICAL COMMANDS BLOCK */}
            {historicalCommands.length > 0 && (
              <div>
                <div className="mono-label" style={{ marginBottom: '12px', opacity: 0.5 }}>[ HISTORICAL_TRACES ]</div>
                {historicalCommands.map((cmd) => (
                  <div key={cmd.id} style={{ marginBottom: '16px' }}>
                    <div className="command-info" style={{ marginBottom: '8px' }}>
                      <span className="command-name" style={{ color: 'var(--on_surface)' }}>
                        #{cmd.id.slice(0, 6)} - {cmd.commandDesc || 'PIO Task'}
                      </span>
                      <span className="command-status" style={{ display: 'block', fontSize: '10px' }}>
                         // {new Date(cmd.timestamp).toISOString().split('T')[1].slice(0,8)}
                      </span>
                    </div>
                    <div style={{ paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                       {cmd.artifacts?.map(art => {
                        const isActive = activeTabRef?.artifactId === art.id;
                        return (
                          <div 
                            key={art.id}
                            className="command-item"
                            onClick={() => onOpenTab({ commandId: cmd.id, artifactId: art.id })}
                            style={{ 
                              cursor: 'pointer', 
                              margin: 0,
                              borderLeft: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                              backgroundColor: isActive ? 'var(--surface_container_high)' : 'transparent',
                              paddingLeft: '14px',
                              marginLeft: '-16px'
                            }}
                          >
                            <div className={`command-dot ${art.status}`}></div>
                            <div className="command-info">
                              <span className="command-name" style={{ color: isActive ? 'var(--primary)' : 'var(--outline)', fontSize: '11px' }}>
                                [ {art.type === 'monitor' ? `Serial: ${art.port?.split('/').pop()}` : art.type.toUpperCase()} ]
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
