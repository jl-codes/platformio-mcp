import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import WorkspaceCockpit from './components/workspace-cockpit.js';
import { ConfigProvider, theme } from 'antd';
// Connect to the background PIO local express server
const parsedToken = new URLSearchParams(window.location.search).get('token') || '';
const parsedProjectDir = new URLSearchParams(window.location.search).get('projectDir') || null;
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
  artifactId?: string;
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
  taskId: string;
};

function App() {
  const [status, setStatus] = useState<'online' | 'offline'>('offline');
  const [authStatus, setAuthStatus] = useState<'checking' | 'valid' | 'invalid'>(parsedToken ? 'checking' : 'invalid');
  const [commands, setCommands] = useState<any[]>([]);
  const [buildLogs, setBuildLogs] = useState<Record<string, LogEvent[]>>({});
  const [buildLogFile, setBuildLogFile] = useState<string | null>(null);
  const [serialLogs, setSerialLogs] = useState<Record<string, LogEvent[]>>({});
  const [spoolerStates, setSpoolerStates] = useState<Record<string, SpoolerState>>({});
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(parsedProjectDir);
  const [lockState, setLockState] = useState<LockState>({ isLocked: false });

  const [openTabs, setOpenTabs] = useState<TabRef[]>([]);
  const [activeTabRef, setActiveTabRef] = useState<TabRef | null>(null);
  const [historicalLogBuffer, setHistoricalLogBuffer] = useState<Record<string, string>>({}); // mapped by artifactId
  const [hardwareDevices, setHardwareDevices] = useState<any[]>([]);

  // Project Selector & Auto-Track
  const [knownWorkspaces, setKnownWorkspaces] = useState<string[]>([]);
  const [autoTrack, setAutoTrack] = useState<boolean>(true);

  const activeWorkspaceRef = useRef(activeWorkspace);
  const autoTrackRef = useRef(autoTrack);

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
  }, [activeWorkspace]);

  useEffect(() => {
    autoTrackRef.current = autoTrack;
  }, [autoTrack]);

  // Fetch initial hardware
  const fetchHardware = async () => {
    try {
      const res = await fetch(`${apiBase}/api/hardware`, { 
        headers: { 'Authorization': `Bearer ${parsedToken}` },
        cache: 'no-store'
      });
      if (res.ok) {
        setHardwareDevices(await res.json());
      } else if (res.status === 401) {
        setAuthStatus('invalid');
      }
    } catch {}
  };

  const fetchWorkspaces = async () => {
    try {
      const res = await fetch(`${apiBase}/api/workspaces`, { 
        headers: { 'Authorization': `Bearer ${parsedToken}` },
        cache: 'no-store'
      });
      if (res.ok) {
        setKnownWorkspaces(await res.json());
      } else if (res.status === 401) {
        setAuthStatus('invalid');
      }
    } catch {}
  };

  // Auto-select first workspace if none is active
  useEffect(() => {
    if (!activeWorkspace && knownWorkspaces.length > 0) {
      setActiveWorkspace(knownWorkspaces[0]);
    }
  }, [activeWorkspace, knownWorkspaces]);

  // Auto-select latest command if none selected? We wait for user to click in IDE mode.
  // We can just keep it empty on load.

  // Fetch full log from disk if a historical command task is selected
  useEffect(() => {
    if (!activeTabRef) return;
    
    // Fallback to history lookup if not live
    const activeHistoricalLog = activeTabRef ? historicalLogBuffer[activeTabRef.taskId] : undefined;

    // Check if we already have it buffered
    if (activeHistoricalLog !== undefined) return;

    let artifact: any = null;
    let actualCommandId = activeTabRef.commandId;
    
    const cmd = commands.find(c => c.id === activeTabRef.commandId);
    if (cmd) {
      artifact = cmd.tasks?.find((a: any) => a.taskId === activeTabRef.taskId);
    }
    
    if (!artifact) {
      for (const c of commands) {
        const found = c.tasks?.find((a: any) => a.taskId === activeTabRef.taskId);
        if (found) {
          artifact = found;
          actualCommandId = c.id;
          break;
        }
      }
    }

    if (!artifact) return;
    if (artifact.status === 'running') return; // rely on live websocket
    
    const fetchLogFile = async () => {
      setHistoricalLogBuffer(prev => ({ ...prev, [activeTabRef.taskId]: "Hydrating static log payload..." }));
      try {
        let url = `${apiBase}/api/logs?commandId=${encodeURIComponent(actualCommandId)}&taskId=${encodeURIComponent(activeTabRef.taskId)}`;
        if (activeWorkspace) url += `&projectDir=${encodeURIComponent(activeWorkspace)}`;
        const res = await fetch(url, { 
          headers: { 'Authorization': `Bearer ${parsedToken}` },
          cache: 'no-store'
        });
        if (res.ok) {
           const logContent = await res.text();
           setHistoricalLogBuffer(prev => ({ ...prev, [activeTabRef.taskId]: logContent }));
        } else {
           setHistoricalLogBuffer(prev => ({ ...prev, [activeTabRef.taskId]: `Failed to map historical log: ${res.statusText}` }));
        }
      } catch (err) {
        setHistoricalLogBuffer(prev => ({ ...prev, [activeTabRef.taskId]: `Failed to fetch log payload via REST.` }));
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
        headers: { 'Authorization': `Bearer ${parsedToken}` },
        cache: 'no-store'
      });
      if (response.ok) {
        const data = await response.json();
        setCommands(data);
      } else if (response.status === 401) {
        setAuthStatus('invalid');
      }
    } catch (e) {
      console.error('Failed to fetch command history', e);
    }
  };

  // Rehydrate command history when workspace context switches
  useEffect(() => {
    if (activeWorkspace) {
      fetchCommandHistory(activeWorkspace);
      fetchWorkspaces();
    }
  }, [activeWorkspace]);

  useEffect(() => {
    if (socket.connected) {
      setAuthStatus('valid');
    }

    socket.on('connect_error', (err) => {
      if (err.message === 'Unauthorized') {
        setAuthStatus('invalid');
      }
    });

    socket.on('connect', () => {
      setAuthStatus('valid');
    });

    socket.on('server_status', (data) => {
      setStatus(data.status);
    });

    socket.on('command_history_updated', (data) => {
      // Auto-Track Context Pivot
      if (autoTrackRef.current && data.projectDir && data.projectDir !== activeWorkspaceRef.current) {
        setActiveWorkspace(data.projectDir);
      }
      
      // Only fetch the command history if the event belongs to our currently active dashboard view 
      // (or if we just auto-switched to it via the block above)
      if (data.projectDir === activeWorkspaceRef.current || (autoTrackRef.current && data.projectDir)) {
        fetchCommandHistory(data.projectDir);
      }
    });

    socket.on('workspace_state', (data: { projectDir: string }) => {
      if (autoTrackRef.current) {
        setActiveWorkspace(data.projectDir);
        fetchCommandHistory(data.projectDir);
      }
      fetchWorkspaces();
    });

    socket.on('workspaces_updated', (data: { workspaces: string[] }) => {
      setKnownWorkspaces(data.workspaces);
    });

    socket.on('build_log', (data: LogEvent & { taskId?: string }) => {
      const id = data.artifactId || data.taskId;
      if (!id) return;
      setBuildLogs(prev => {
        const next = [...(prev[id] || []), data];
        return {
          ...prev,
          [id]: next.slice(-500)
        };
      });
    });

    socket.on('build_clear', (data: { logFile?: string, artifactId?: string, taskId?: string }) => {
      const id = data.artifactId || data.taskId;
      if (id) {
        setBuildLogs(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        setBuildLogs({});
      }
      setBuildLogFile(data.logFile || null);
    });

    socket.on('build_state', (data: { logFile?: string }) => {
      setBuildLogFile(data.logFile || null);
    });

    socket.on('serial_log', (data: LogEvent & { taskId?: string }) => {
      const id = data.artifactId || data.taskId;
      if (!id) return;
      setSerialLogs(prev => {
        const portLogs = prev[id] || [];
        const next = [...portLogs, data];
        return {
          ...prev,
          [id]: next.slice(-1000)
        };
      });
    });

    socket.on('serial_clear', (data: { port: string, artifactId?: string, taskId?: string }) => {
      const id = data.artifactId || data.taskId;
      if (id) {
        setSerialLogs(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        // Fallback or ignore if no artifactId
      }
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
    fetchWorkspaces();

    return () => {
      socket.off('connect_error');
      socket.off('connect');
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

  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);

  if (authStatus === 'invalid') {
    return (
      <ConfigProvider theme={{ algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
        <div style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: isDarkMode ? '#1E1E1E' : '#ffffff', flexDirection: 'column', gap: 24 }}>
          <img src="/pio_mcp_220x220.png" alt="PIO MCP" style={{ height: '80px', width: '80px', objectFit: 'contain' }} />
          <div style={{ color: isDarkMode ? '#989898' : '#333333', fontSize: '18px', fontFamily: 'Fira Code, monospace', textAlign: 'center' }}>
            Access Denied: The dashboard token is invalid or has expired.
          </div>
        </div>
      </ConfigProvider>
    );
  }

  if (authStatus === 'checking') {
    return (
      <ConfigProvider theme={{ algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
        <div style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: isDarkMode ? '#1E1E1E' : '#ffffff' }}>
          <img src="/pio_mcp_220x220.png" alt="PIO MCP" style={{ height: '60px', width: '60px', objectFit: 'contain', opacity: 0.3, animation: 'pulse 1.5s infinite' }} />
          <style>{`
            @keyframes pulse {
              0% { opacity: 0.3; transform: scale(1); }
              50% { opacity: 0.8; transform: scale(1.05); }
              100% { opacity: 0.3; transform: scale(1); }
            }
          `}</style>
        </div>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#4080D0',
          colorBgBase: isDarkMode ? '#1E1E1E' : '#ffffff',
          colorText: isDarkMode ? '#989898' : '#333333',
        },
        components: {
          Layout: {
            siderBg: isDarkMode ? '#323232' : '#ffffff',
            headerBg: isDarkMode ? '#323232' : '#ececec',
            bodyBg: isDarkMode ? '#1E1E1E' : '#ffffff',
          },
          Menu: {
            darkItemBg: '#323232',
            darkItemColor: '#989898',
            darkItemSelectedBg: '#4080D0',
          }
        }
      }}
    >
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
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
        knownWorkspaces={knownWorkspaces}
        setActiveWorkspace={setActiveWorkspace}
        autoTrack={autoTrack}
        setAutoTrack={setAutoTrack}
      />
    </ConfigProvider>
  );
}

export default App;
