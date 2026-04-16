/**
 * Application Root Component
 * Wires up socket connections and manages the global React state.
 *
 * Provides:
 * - App: Main React Component
 */
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import AgentActivity from './components/agent-activity.js';
import BuildTerminal from './components/build-terminal.js';
import SerialLog from './components/serial-log.js';
import SettingsPanel from './components/settings-panel.js';

// Connect to the background PIO local express server
const parsedToken = new URLSearchParams(window.location.search).get('token') || '';
const socket: Socket = io(window.location.origin.includes('localhost:5173') ? 'http://localhost:8080' : '/', { auth: { token: parsedToken } });

/**
 * Event representing a tool execution by an agent.
 */
export type AgentEvent = {
  timestamp: number; // High-resolution timestamp of the activity
  toolName: string; // Name of the MCP tool invoked
  args: Record<string, any>; // Input parameters provided by the agent
  success: boolean; // Execution status
};

/**
 * Event representing a line of output from build or serial streams.
 */
export type LogEvent = {
  timestamp: number; // High-resolution timestamp of the log line
  projectId?: string; // Target project identifier (for build logs)
  port?: string; // TTY port identifier (for serial logs)
  logLine?: string; // Content of the build log line
  data?: string; // Content of the serial log line
};

/**
 * Current runtime state of a background serial spooler.
 */
export type SpoolerState = {
  active: boolean; // Indicates if the spooler is actively running
  status: 'Idle' | 'Logging' | 'Flashing' | 'Connecting'; // Logical connection status
  port?: string; // Bound serial port path
  logFile?: string; // Current active log file path
  autoReconnect: boolean; // Indicates if auto-recovery is enabled
};

/**
 * Global mutex state for the physical hardware pipeline.
 */
export type LockState = {
  isLocked: boolean; // Indicates if the hardware is currently reserved
  sessionId?: string; // Identifier of the session holding the lock
  reason?: string; // Human-readable reason for the lock
};

function App() {
  const [status, setStatus] = useState<'online' | 'offline'>('offline');
  const [activities, setActivities] = useState<AgentEvent[]>([]);
  const [buildLogs, setBuildLogs] = useState<LogEvent[]>([]);
  const [buildLogFile, setBuildLogFile] = useState<string | null>(null);
  const [serialLogs, setSerialLogs] = useState<Record<string, LogEvent[]>>({});
  const [spoolerStates, setSpoolerStates] = useState<Record<string, SpoolerState>>({});
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [lockState, setLockState] = useState<LockState>({ isLocked: false });

  useEffect(() => {
    socket.on('server_status', (data) => {
      setStatus(data.status);
    });

    socket.on('agent_activity', (data: AgentEvent) => {
      setActivities(prev => {
        const next = [data, ...prev];
        return next.slice(0, 100); // keep last 100 events
      });
    });

    socket.on('build_log', (data: LogEvent) => {
      setBuildLogs(prev => {
        const next = [...prev, data];
        return next.slice(-500); // keep last 500 lines
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
          [data.port!]: next.slice(-1000) // keep last 1000 lines per port
        };
      });
    });

    socket.on('spooler_states', (data: Record<string, SpoolerState>) => {
      setSpoolerStates(data);
    });

    socket.on('workspace_state', (data: { projectDir: string }) => {
      setActiveWorkspace(data.projectDir);
    });

    socket.on('lock_state', (data: LockState) => {
      setLockState(data);
    });

    return () => {
      socket.off('server_status');
      socket.off('agent_activity');
      socket.off('build_log');
      socket.off('build_clear');
      socket.off('build_state');
      socket.off('serial_log');
      socket.off('spooler_states');
      socket.off('workspace_state');
      socket.off('lock_state');
    };
  }, []);

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-brand">
          <h1>PIO MCP Server</h1>
          <div className={`status-badge ${status}`}>
            <span className="dot"></span>
            {status.toUpperCase()}
          </div>
        </div>
      </header>

      <main className="dashboard-grid">
        <div className="grid-column left-column">
          <AgentActivity activities={activities} />
          <SettingsPanel status={status} socket={socket} lockState={lockState} />
        </div>
        <div className="grid-column right-column">
          <BuildTerminal logs={buildLogs} logFile={buildLogFile || undefined} />
          <SerialLog logs={serialLogs} spoolerStates={spoolerStates} activeWorkspace={activeWorkspace} lockState={lockState} />
        </div>
      </main>
    </div>
  )
}

export default App;
