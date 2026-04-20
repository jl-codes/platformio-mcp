import React from 'react';
import { AgentEvent, LogEvent, SpoolerState, LockState, TabRef } from '../App.js';
import CommandFeed from './command-feed.js';
import IDEWorkspace from './ide-workspace.js';
import HardwareRack from './hardware-rack.js';

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
  hardware = []
}: WorkspaceCockpitProps) {
  
  const handleOpenTab = (tab: TabRef) => {
    if (!openTabs.find(t => t.artifactId === tab.artifactId)) {
      setOpenTabs([...openTabs, tab]);
    }
    setActiveTabRef(tab);
  };
  
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
          <HardwareRack hardware={hardware} />
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
        
      </main>
    </div>
  );
}
