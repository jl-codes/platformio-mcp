import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import WorkspaceCockpit from './components/workspace-cockpit.js';

// Connect to the background PIO local express server
const parsedToken = new URLSearchParams(window.location.search).get('token') || '';
// Detect API base implicitly during local development
const apiBase = window.location.origin.includes('localhost:5173') ? 'http://localhost:8080' : '';
const socket: Socket = io(apiBase || '/', { auth: { token: parsedToken } });

export type AgentEvent = {
  timestamp: number;
  toolName: string;
  args: Record<string, any>;
  success: boolean;
  status?: 'running' | 'success' | 'error';
  activityId?: string;
};

export type LogEvent = {
  timestamp: number;
  projectId?: string;
  port?: string;
  logLine?: string;
  data?: string;
};

export type SpoolerState = {
  active: boolean;
  status: 'Idle' | 'Logging' | 'Flashing' | 'Connecting';
  port?: string;
  logFile?: string;
  autoReconnect: boolean;
};

export type LockState = {
  isLocked: boolean;
  sessionId?: string;
  reason?: string;
};

export type TabRef = {
  commandId: string;
  artifactId: string;
};

function App() {
  const [status, setStatus] = useState<'online' | 'offline'>('offline');
  const [commands, setCommands] = useState<any[]>([]);
  const [buildLogs, setBuildLogs] = useState<LogEvent[]>([]);
  const [buildLogFile, setBuildLogFile] = useState<string | null>(null);
  const [serialLogs, setSerialLogs] = useState<Record<string, LogEvent[]>>({});
  const [spoolerStates, setSpoolerStates] = useState<Record<string, SpoolerState>>({});
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [lockState, setLockState] = useState<LockState>({ isLocked: false });

  const [openTabs, setOpenTabs] = useState<TabRef[]>([]);
  const [activeTabRef, setActiveTabRef] = useState<TabRef | null>(null);
  const [historicalLogBuffer, setHistoricalLogBuffer] = useState<Record<string, string>>({}); // mapped by artifactId
  const [hardwareDevices, setHardwareDevices] = useState<any[]>([]);

  // Fetch initial hardware
  const fetchHardware = async () => {
    try {
      const res = await fetch(`${apiBase}/api/hardware`, { headers: { 'Authorization': `Bearer ${parsedToken}` } });
      if (res.ok) {
        setHardwareDevices(await res.json());
      }
    } catch {}
  };

  // Auto-select latest command if none selected? We wait for user to click in IDE mode.
  // We can just keep it empty on load.

  // Fetch full log from disk if a historical command artifact is selected
  useEffect(() => {
    if (!activeTabRef) return;
    
    // Check if we already have it buffered
    if (historicalLogBuffer[activeTabRef.artifactId]) return;

    const cmd = commands.find(c => c.id === activeTabRef.commandId);
    if (!cmd) return;
    
    const artifact = cmd.artifacts?.find((a: any) => a.id === activeTabRef.artifactId);
    if (!artifact) return;

    if (artifact.status === 'running') return; // rely on live websocket
    
    const fetchLogFile = async () => {
      setHistoricalLogBuffer(prev => ({ ...prev, [activeTabRef.artifactId]: "Hydrating static log payload..." }));
      try {
        let url = `${apiBase}/api/logs?commandId=${encodeURIComponent(activeTabRef.commandId)}&artifactId=${encodeURIComponent(activeTabRef.artifactId)}`;
        if (activeWorkspace) url += `&projectDir=${encodeURIComponent(activeWorkspace)}`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${parsedToken}` } });
        if (res.ok) {
           const logContent = await res.text();
           setHistoricalLogBuffer(prev => ({ ...prev, [activeTabRef.artifactId]: logContent }));
        } else {
           setHistoricalLogBuffer(prev => ({ ...prev, [activeTabRef.artifactId]: `Failed to map historical log: ${res.statusText}` }));
        }
      } catch (err) {
        setHistoricalLogBuffer(prev => ({ ...prev, [activeTabRef.artifactId]: `Failed to fetch log payload via REST.` }));
      }
    };
    fetchLogFile();
  }, [activeTabRef, activeWorkspace, commands, historicalLogBuffer]);

  // Dedicated fetch to synchronize with the backend CommandRegistry
  const fetchCommandHistory = async (projectDir?: string) => {
    try {
      let url = `${apiBase}/api/commands`;
      if (projectDir) url += `?projectDir=${encodeURIComponent(projectDir)}`;
      
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${parsedToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setCommands(data);
      }
    } catch (e) {
      console.error('Failed to fetch command history', e);
    }
  };

  useEffect(() => {
    socket.on('server_status', (data) => {
      setStatus(data.status);
    });

    socket.on('command_history_updated', (data) => {
      fetchCommandHistory(data.projectDir);
    });

    socket.on('workspace_state', (data: { projectDir: string }) => {
      setActiveWorkspace(data.projectDir);
      fetchCommandHistory(data.projectDir);
    });

    socket.on('build_log', (data: LogEvent) => {
      setBuildLogs(prev => {
        const next = [...prev, data];
        return next.slice(-500);
      });
    });

    socket.on('build_clear', (data: { logFile?: string }) => {
      setBuildLogs([]);
      setBuildLogFile(data.logFile || null);
    });

    socket.on('build_state', (data: { logFile?: string }) => {
      setBuildLogFile(data.logFile || null);
    });

    socket.on('serial_log', (data: LogEvent) => {
      if (!data.port) return;
      setSerialLogs(prev => {
        const portLogs = prev[data.port!] || [];
        const next = [...portLogs, data];
        return {
          ...prev,
          [data.port!]: next.slice(-1000)
        };
      });
    });

    socket.on('serial_clear', (data: { port: string }) => {
      setSerialLogs(prev => {
        const next = { ...prev };
        delete next[data.port];
        return next;
      });
    });

    socket.on('spooler_states', (data: Record<string, SpoolerState>) => {
      setSpoolerStates(data);
    });

    socket.on('lock_state', (data: LockState) => {
      setLockState(data);
    });

    socket.on('hardware_state_updated', (data: { devices: any[] }) => {
      setHardwareDevices(data.devices || []);
    });

    // Initial manual fetch incase WS event missed
    fetchCommandHistory();
    fetchHardware();

    return () => {
      socket.off('server_status');
      socket.off('command_history_updated');
      socket.off('build_log');
      socket.off('build_clear');
      socket.off('build_state');
      socket.off('serial_log');
      socket.off('serial_clear');
      socket.off('spooler_states');
      socket.off('workspace_state');
      socket.off('lock_state');
      socket.off('hardware_state_updated');
    };
  }, []);

  return (
    <WorkspaceCockpit 
      status={status}
      commands={commands}
      buildLogs={buildLogs}
      buildLogFile={buildLogFile || undefined}
      serialLogs={serialLogs}
      spoolerStates={spoolerStates}
      activeWorkspace={activeWorkspace}
      lockState={lockState}
      openTabs={openTabs}
      setOpenTabs={setOpenTabs}
      activeTabRef={activeTabRef}
      setActiveTabRef={setActiveTabRef}
      historicalLogBuffer={historicalLogBuffer}
      hardware={hardwareDevices}
      apiBase={apiBase}
      token={parsedToken}
    />
  );
}

export default App;
