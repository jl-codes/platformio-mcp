import React from 'react';
import { AgentEvent, LogEvent, SpoolerState, LockState, TabRef } from '../App.js';
import CommandFeed from './command-feed.js';
import IDEWorkspace from './ide-workspace.js';
import HardwareRack from './hardware-rack.js';
import WorkspaceConfig from './workspace-config.js';
import CommandLauncher from './command-launcher.js';

interface WorkspaceCockpitProps {
  status: 'online' | 'offline';
  commands: any[]; // Using CommandRecord array
  buildLogs: LogEvent[];
  buildLogFile: string | undefined;
  serialLogs: Record<string, LogEvent[]>;
  spoolerStates: Record<string, SpoolerState>;
  activeWorkspace: string | null;
  lockState: LockState;
  openTabs: TabRef[];
  setOpenTabs: (tabs: TabRef[]) => void;
  activeTabRef: TabRef | null;
  setActiveTabRef: (tab: TabRef | null) => void;
  historicalLogBuffer: Record<string, string>;
  hardware?: any[];
  apiBase: string;
  token: string;
}

export default function WorkspaceCockpit({
  status,
  commands,
  buildLogs,
  buildLogFile,
  serialLogs,
  spoolerStates,
  activeWorkspace,
  lockState,
  openTabs,
  setOpenTabs,
  activeTabRef,
  setActiveTabRef,
  historicalLogBuffer,
  hardware = [],
  apiBase,
  token
}: WorkspaceCockpitProps) {
  
  const handleOpenTab = (tab: TabRef) => {
    if (!openTabs.find(t => t.artifactId === tab.artifactId)) {
      setOpenTabs([...openTabs, tab]);
    }
    setActiveTabRef(tab);
  };
  
  const [isLauncherOpen, setIsLauncherOpen] = React.useState(false);

  return (
    <div className="cockpit-container">
      {/* TopAppBar Global Context Switcher */}
      <header className="top-header">
        <div className="flex items-center" style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
          <span className="header-brand">KINETIC_COMMAND</span>
          <div className="context-switcher">
            <span className="dot"></span>
            AUTO-TRACKING ({activeWorkspace ? activeWorkspace.split('/').pop() : 'WAITING'})
          </div>
          <button 
            className="lib-btn" 
            style={{ borderColor: 'var(--secondary)', color: 'var(--secondary)' }}
            onClick={() => setIsLauncherOpen(true)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>rocket_launch</span>
            NEW RUN
          </button>
        </div>
        <div className="flex items-center" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <span className="mono-label" style={{ color: status === 'online' ? 'var(--secondary)' : 'var(--outline)' }}>
            SERVER: {status.toUpperCase()}
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-content">
        
        {/* Module 1: Agent Command Trace & Hardware */}
        <div className="sidebar-left">
          <CommandFeed 
            commands={commands} 
            activeTabRef={activeTabRef}
            onOpenTab={handleOpenTab} 
          />
          <HardwareRack 
            hardware={hardware} 
            activeWorkspace={activeWorkspace}
            apiBase={apiBase}
            token={token}
          />
        </div>

        {/* Module 2: IDE Workspace Interface */}
        <IDEWorkspace 
          openTabs={openTabs}
          setOpenTabs={setOpenTabs}
          activeTabRef={activeTabRef}
          setActiveTabRef={setActiveTabRef}
          commands={commands}
          buildLogs={buildLogs}
          buildLogFile={buildLogFile}
          serialLogs={serialLogs}
          spoolerStates={spoolerStates}
          activeWorkspace={activeWorkspace}
          lockState={lockState}
          historicalLogBuffer={historicalLogBuffer}
        />
        
        {/* Module 3: Workspace Config & libraries */}
        <WorkspaceConfig 
          activeWorkspace={activeWorkspace}
          lockState={lockState}
          apiBase={apiBase}
          token={token}
        />
        
      </main>

      <CommandLauncher 
        isOpen={isLauncherOpen}
        onClose={() => setIsLauncherOpen(false)}
        activeWorkspace={activeWorkspace}
        hardware={hardware}
        apiBase={apiBase}
        token={token}
      />
    </div>
  );
}
