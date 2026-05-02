import React, { useRef, useState, useEffect } from 'react';
import { Tabs, Badge, Typography, Empty, Button } from 'antd';
import { TabRef, LogEvent, SpoolerState, LockState } from '../app.js';

const { Text } = Typography;

interface IDEWorkspaceProps {
  openTabs: TabRef[];
  setOpenTabs: (tabs: TabRef[]) => void;
  activeTabRef: TabRef | null;
  setActiveTabRef: (tab: TabRef | null) => void;
  commands: any[];
  buildLogs: Record<string, LogEvent[]>;
  buildLogFile: string | undefined;
  serialLogs: Record<string, LogEvent[]>;
  spoolerStates: Record<string, SpoolerState>;
  activeWorkspace: string | null;
  lockState: LockState;
  historicalLogBuffer: Record<string, string>;
}

export default function IDEWorkspace({
  openTabs, setOpenTabs, activeTabRef, setActiveTabRef,
  commands, buildLogs, serialLogs, historicalLogBuffer
}: IDEWorkspaceProps) {
  
  const handleEdit = (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
    if (action === 'remove' && typeof targetKey === 'string') {
      const newTabs = openTabs.filter(t => t.taskId !== targetKey);
      setOpenTabs(newTabs);
      if (activeTabRef?.taskId === targetKey) {
        setActiveTabRef(newTabs.length > 0 ? newTabs[newTabs.length - 1] : null);
      }
    }
  };

  const getArtifactInfo = (tab: TabRef) => {
    let cmd = commands.find(c => c.id === tab.commandId);
    let art = cmd?.tasks?.find((a: any) => a.taskId === tab.taskId);

    if (!art) {
       for (const c of commands) {
         const found = c.tasks?.find((a: any) => a.taskId === tab.taskId);
         if (found) {
           art = found;
           break;
         }
       }
    }

    if (!art) {
      if (tab.commandId === 'hardware-rack') {
        return {
          name: `MONITOR (Live)`,
          status: 'running',
          type: 'monitor',
          port: tab.taskId
        };
      }
      return { name: "UNKNOWN", status: "terminated", type: "build" };
    }
    
    const timestamp = cmd ? new Date(cmd.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'}) : 'Unknown';
    return {
      name: `${art.type.toUpperCase()} ${timestamp}`,
      status: art.status,
      type: art.type,
      port: art.port
    };
  };

  if (openTabs.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty description={<Text type="secondary" style={{ fontFamily: 'Fira Code' }}>NO TABS OPEN. SELECT A TRACE FROM THE COMMAND FEED.</Text>} />
      </div>
    );
  }

  const tabItems = openTabs.map(tab => {
    const info = getArtifactInfo(tab);
    const getTabBadgeProps = () => {
      if (info.status === 'running') {
        if (info.type === 'upload') return { status: 'processing' as const, color: 'gold' };
        return { status: 'processing' as const, color: 'green' };
      }
      if (info.status === 'error') return { status: 'error' as const, color: 'red' };
      return { status: 'default' as const, color: 'blue' };
    };

    return {
      key: tab.taskId,
      label: (
        <span style={{ fontFamily: 'Fira Code', fontSize: '12px' }}>
          <Badge {...getTabBadgeProps()} /> {info.name}
        </span>
      ),
      children: (
        <TerminalView 
          status={info.status} 
          type={info.type} 
          historicalLog={historicalLogBuffer[tab.taskId]}
          port={info.port!} 
          serialLogs={serialLogs} 
          buildLogs={buildLogs} 
          taskId={tab.taskId} 
        />
      )
    };
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Tabs 
        hideAdd
        className="ide-tabs"
        type="editable-card"
        onChange={(key) => {
          const tab = openTabs.find(t => t.taskId === key);
          if (tab) setActiveTabRef(tab);
        }}
        activeKey={activeTabRef?.taskId}
        onEdit={handleEdit}
        items={tabItems}
        size="small"
        style={{ height: '100%' }}
      />
    </div>
  );
}

// Inline pure renderers
function TerminalView({ status, type, historicalLog, port, serialLogs, buildLogs, taskId }: any) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAnchored, setIsAnchored] = useState(true);

  // Auto-scroll logic
  useEffect(() => {
    if (!containerRef.current || !isAnchored) return;
    const container = containerRef.current;
    container.scrollTop = container.scrollHeight;
  }); // Run on every render to catch new logs

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    // 50px threshold to break anchor
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsAnchored(isAtBottom);
  };

  return (
    <div 
      ref={containerRef}
      onScroll={handleScroll}
      style={{ padding: '16px', overflowY: 'auto', height: '100%', fontFamily: 'Fira Code', fontSize: '13px', position: 'relative' }}
    >
      {status !== 'running' ? (
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
          {historicalLog || "Loading historic payload..."}
        </pre>
      ) : (
        type === 'monitor' ? (
          <SerialLogRaw port={port} serialLogs={serialLogs} artifactId={taskId} />
        ) : (
          <BuildTerminalRaw buildLogs={buildLogs[taskId] || []} />
        )
      )}
      
      {/* Anchor broken indicator */}
      {!isAnchored && status === 'running' && (
        <div 
          onClick={() => {
            setIsAnchored(true);
            if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
          }}
          style={{ 
            position: 'absolute', 
            bottom: 24, 
            right: 32, 
            background: '#1890ff', 
            color: '#fff', 
            padding: '4px 12px', 
            borderRadius: 16, 
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
            fontSize: 11,
            zIndex: 10
          }}
        >
          Resume Auto-Scroll
        </div>
      )}
    </div>
  );
}

function SerialLogRaw({ port, serialLogs, artifactId }: { port: string, serialLogs: Record<string, LogEvent[]>, artifactId: string }) {
  const logs = serialLogs[artifactId] || [];
  return (
    <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
      <div style={{ opacity: 0.5, marginBottom: '16px' }}>[ CONNECTED LIVE STREAM: {port} ]</div>
      {logs.map((log, i) => (
        <span key={i} style={{ color: '#4080D0' }}>{log.data}</span>
      ))}
    </div>
  );
}

function BuildTerminalRaw({ buildLogs }: { buildLogs: LogEvent[] }) {
  return (
    <>
      <div style={{ opacity: 0.5, marginBottom: '16px' }}>[ COMPILER LIVE TTY ]</div>
      {buildLogs.map((log, i) => (
        <div key={i} style={{ display: 'flex' }}>
          <span style={{ color: '#4080D0', marginRight: '16px' }}>{'>'}</span>
          <span dangerouslySetInnerHTML={{ __html: log.logLine || '' }}></span>
        </div>
      ))}
    </>
  );
}
