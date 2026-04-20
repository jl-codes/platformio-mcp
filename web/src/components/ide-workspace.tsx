import React from 'react';
import { TabRef, LogEvent, SpoolerState, LockState } from '../App.js';
// We'll borrow the visual style from BuildTerminal/SerialLog
import BuildTerminal from './build-terminal.js';
import SerialLog from './serial-log.js';

interface IDEWorkspaceProps {
  openTabs: TabRef[];
  setOpenTabs: (tabs: TabRef[]) => void;
  activeTabRef: TabRef | null;
  setActiveTabRef: (tab: TabRef | null) => void;
  
  commands: any[];
  buildLogs: LogEvent[];
  buildLogFile: string | undefined;
  serialLogs: Record<string, LogEvent[]>;
  spoolerStates: Record<string, SpoolerState>;
  activeWorkspace: string | null;
  lockState: LockState;
  historicalLogBuffer: Record<string, string>;
}

export default function IDEWorkspace({
  openTabs,
  setOpenTabs,
  activeTabRef,
  setActiveTabRef,
  commands,
  buildLogs,
  buildLogFile,
  serialLogs,
  spoolerStates,
  activeWorkspace,
  lockState,
  historicalLogBuffer
}: IDEWorkspaceProps) {
  
  const handleCloseTab = (e: React.MouseEvent, tabToClose: TabRef) => {
    e.stopPropagation();
    const newTabs = openTabs.filter(t => t.artifactId !== tabToClose.artifactId);
    setOpenTabs(newTabs);
    
    if (activeTabRef?.artifactId === tabToClose.artifactId) {
      setActiveTabRef(newTabs.length > 0 ? newTabs[newTabs.length - 1] : null);
    }
  };

  const getArtifactInfo = (tab: TabRef) => {
    const cmd = commands.find(c => c.id === tab.commandId);
    if (!cmd) return { name: "Unknown", status: "terminated", type: "build" };
    const art = cmd.artifacts?.find((a: any) => a.id === tab.artifactId);
    if (!art) return { name: "Unknown", status: "terminated", type: "build" };
    
    return {
      name: art.type === "monitor" ? `Serial: ${art.port?.split('/').pop() || 'Unknown'}` : `${art.type.toUpperCase()} Log`,
      status: art.status,
      type: art.type,
      port: art.port
    };
  };

  if (openTabs.length === 0) {
    return (
      <div style={{ flex: 1, backgroundColor: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--outline)', fontFamily: 'Fira Code' }}>
        NO TABS OPEN. SELECT A TRACE FROM THE COMMAND FEED.
      </div>
    );
  }

  const activeArtInfo = activeTabRef ? getArtifactInfo(activeTabRef) : null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface)', overflow: 'hidden' }}>
      {/* IDE Tab Bar */}
      <div style={{ 
        display: 'flex', 
        backgroundColor: '#0A0A0B', 
        borderBottom: '1px solid var(--outline_variant)',
        overflowX: 'auto',
        minHeight: '40px'
      }}>
        {openTabs.map(tab => {
          const info = getArtifactInfo(tab);
          const isActive = activeTabRef?.artifactId === tab.artifactId;
          return (
            <div 
              key={tab.artifactId}
              onClick={() => setActiveTabRef(tab)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '0 16px',
                height: '40px',
                backgroundColor: isActive ? 'var(--surface)' : 'transparent',
                color: isActive ? 'var(--primary)' : 'var(--outline)',
                borderTop: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                borderRight: '1px solid var(--outline_variant)',
                cursor: 'pointer',
                fontFamily: 'Fira Code',
                fontSize: '12px'
              }}
            >
              <div 
                className={`command-dot ${info.status}`} 
                style={{ width: '8px', height: '8px', borderRadius: '50%' }}
              />
              {info.name}
              <span 
                onClick={(e) => handleCloseTab(e, tab)}
                style={{ marginLeft: '8px', cursor: 'pointer', padding: '2px', opacity: 0.7 }}
              >
                ×
              </span>
            </div>
          );
        })}
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {activeTabRef && activeArtInfo && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px', backgroundColor: 'var(--surface)', overflowY: 'auto', fontFamily: 'Fira Code', fontSize: '12px', color: 'var(--on_surface)' }}>
            
            {activeArtInfo.status !== 'running' ? (
               <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                 {historicalLogBuffer[activeTabRef.artifactId] || "Loading historic payload..."}
               </pre>
            ) : (
               /* Live Buffer Rendering */
               activeArtInfo.type === 'monitor' ? (
                 <SerialLogRaw 
                    port={activeArtInfo.port!} 
                    serialLogs={serialLogs} 
                 />
               ) : (
                 <BuildTerminalRaw 
                    buildLogs={buildLogs} 
                 />
               )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Inline pure renderers for the live buffers to avoid refactoring the entire old components heavily right now.
function SerialLogRaw({ port, serialLogs }: { port: string, serialLogs: Record<string, LogEvent[]> }) {
  const logs = serialLogs[port] || [];
  return (
    <>
      <div style={{ opacity: 0.5, marginBottom: '16px' }}>[ CONNECTED LIVE STREAM: {port} ]</div>
      {logs.map((log, i) => (
        <span key={i} style={{ color: 'var(--secondary)' }}>
          {log.data}
        </span>
      ))}
    </>
  );
}

function BuildTerminalRaw({ buildLogs }: { buildLogs: LogEvent[] }) {
  return (
    <>
      <div style={{ opacity: 0.5, marginBottom: '16px' }}>[ COMPILER LIVE TTY ]</div>
      {buildLogs.map((log, i) => (
        <div key={i} className="terminal-line" style={{ display: 'flex' }}>
          <span className="terminal-prefix" style={{ color: 'var(--secondary)', marginRight: '16px' }}>{'>'}</span>
          <span className="terminal-text" dangerouslySetInnerHTML={{ __html: log.logLine || '' }}></span>
        </div>
      ))}
    </>
  );
}
