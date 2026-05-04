import React, { useState } from 'react';
import { Badge, Typography, Collapse, Button, Space, Switch, Tooltip, Tag, Divider, Segmented, theme } from 'antd';
import { 
  ExperimentOutlined, 
  CheckSquareOutlined, 
  CodeOutlined, 
  SyncOutlined, 
  PlaySquareOutlined,
  ToolOutlined,
  CloudUploadOutlined,
  FileTextOutlined,
  DashboardOutlined,
  ClearOutlined,
  FolderAddOutlined,
  SettingOutlined,
  HddOutlined,
  UsbOutlined,
  InfoCircleOutlined,
  AppstoreOutlined,
  PlayCircleOutlined,
  StopOutlined,
  PauseCircleOutlined,
  QuestionCircleOutlined,
  AlignLeftOutlined,
  SearchOutlined,
  DownloadOutlined,
  DeleteOutlined,
  BookOutlined,
  LockOutlined,
  UnlockOutlined,
  KeyOutlined,
  ClockCircleOutlined,
  PoweroffOutlined,
  GlobalOutlined,
  DesktopOutlined,
  RobotOutlined,
  UserOutlined
} from '@ant-design/icons';
import { TabRef } from '../app.js';
import CommandLauncher from './command-launcher.js';

const { Text } = Typography;
const { Panel } = Collapse;

/**
 * Command Feed Component
 * Displays the real-time telemetry and execution history of tasks initiated 
 * by agents and users via the MCP.
 *
 * Provides:
 * - CommandFeed: React component rendering the activity ledger.
 * - TaskRecord: Type representing a single spawned system task.
 * - CommandRecord: Type representing a parent MCP command execution.
 */

/**
 * Represents a discrete task spawned by the command executor.
 */
export interface TaskRecord {
  taskId: string; // Unique identifier for the task
  type: "build" | "monitor" | "upload" | "check" | "test" | "debug"; // Classification of the task
  status: "inactive" | "running" | "success" | "error" | "terminated"; // Current execution status
  logPaths?: string[]; // Array of associated log file paths on disk
  port?: string; // Optional target hardware port for upload/monitor
  pid?: number; // OS process ID of the running task
  exitCode?: number; // Final exit code if terminated
}

/**
 * Represents an overarching MCP execution command and its child tasks.
 */
export interface CommandRecord {
  id: string; // Unique UUID for the execution
  commandDesc: string; // Plain-text description
  timestamp: number; // Epoch timestamp of initiation
  status: "running" | "success" | "error" | "terminated"; // Master status reflecting its children
  tasks: TaskRecord[]; // Array of spawned sub-tasks
  mcpRequest?: any; // Raw JSON payload sent to the MCP Server
  mcpResponse?: any; // Raw JSON payload returned by the MCP Server
  mcpToolName?: string; // Name of the MCP Tool invoked
  source?: "agent" | "dashboard"; // Originator of the request
}

/**
 * Props for the CommandFeed component.
 */
export interface CommandFeedProps {
  commands: CommandRecord[]; // Chronological array of execution records
  onOpenTab: (tab: TabRef) => void; // Callback to open log tabs
  activeTabRef: TabRef | null; // Currently viewed tab
  activeWorkspace?: string | null; // Project directory currently in context
  hardware?: any[]; // Hardware states mapping
  spoolerStates?: Record<string, any>; // Active serial monitor daemons
  apiBase?: string; // Dashboard Backend API URL
  token?: string; // Security token
}

const parseLeniently = (str: string): any => {
  let pos = 0;
  
  const skipWhitespace = () => {
    while (pos < str.length && (str[pos] === ' ' || str[pos] === '\n' || str[pos] === '\r' || str[pos] === '\t')) pos++;
  };

  const parseString = () => {
    pos++; 
    let res = '';
    while (pos < str.length && str[pos] !== '"') {
      if (str[pos] === '\\') {
        pos++;
        if (pos < str.length) {
          if (str[pos] === 'n') res += '\n';
          else if (str[pos] === 't') res += '\t';
          else if (str[pos] === 'r') res += '\r';
          else res += str[pos];
        }
      } else {
        res += str[pos];
      }
      pos++;
    }
    if (pos < str.length && str[pos] === '"') pos++; 
    return res;
  };

  const parseNumberOrLiteral = () => {
    let res = '';
    const startPos = pos;
    while (pos < str.length && !/[ \n\r\t,\]}:]/.test(str[pos])) {
      res += str[pos];
      pos++;
    }
    if (pos === startPos) {
      res += str[pos];
      pos++;
    }
    if (res === 'true') return true;
    if (res === 'false') return false;
    if (res === 'null') return null;
    const num = Number(res);
    return isNaN(num) ? res : num;
  };

  const parseValue = (): any => {
    skipWhitespace();
    if (pos >= str.length) return undefined;

    const c = str[pos];
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '"') return parseString();
    
    return parseNumberOrLiteral();
  };

  const parseArray = () => {
    pos++; 
    const arr: any[] = [];
    while (pos < str.length) {
      skipWhitespace();
      if (pos >= str.length) break;
      if (str[pos] === ']') { pos++; break; }
      if (str[pos] === ',') { pos++; continue; }
      
      const val = parseValue();
      if (val !== undefined) arr.push(val);
      else break;
    }
    return arr;
  };

  const parseObject = () => {
    pos++; 
    const obj: any = {};
    while (pos < str.length) {
      skipWhitespace();
      if (pos >= str.length) break;
      if (str[pos] === '}') { pos++; break; }
      if (str[pos] === ',') { pos++; continue; }
      
      let key = '';
      if (str[pos] === '"') {
        key = parseString();
      } else {
        key = String(parseNumberOrLiteral());
        if (!key) break;
      }
      
      skipWhitespace();
      if (pos >= str.length) { obj[key] = "..."; break; }
      if (str[pos] === ':') {
        pos++;
        const val = parseValue();
        obj[key] = val !== undefined ? val : "...";
      } else {
        obj[key] = "...";
      }
    }
    return obj;
  };

  return parseValue();
};

const renderDataTree = (data: any, depth = 0): React.ReactNode => {
  if (data === undefined) return null;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (typeof parsed === 'object' && parsed !== null) {
        return renderDataTree(parsed, depth);
      }
    } catch {}
    
    let cleanedStr = data;
    if (typeof cleanedStr === 'string') {
      cleanedStr = cleanedStr.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      cleanedStr = cleanedStr.replace(/\.\.\.\s*\[TRUNCATED\]$/, '');
      
      try {
        const lenientParsed = parseLeniently(cleanedStr);
        if (typeof lenientParsed === 'object' && lenientParsed !== null) {
          return renderDataTree(lenientParsed, depth);
        }
      } catch (e) {}
    }
    return <span style={{ color: '#a6a6a6', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{cleanedStr}</span>;
  }
  
  if (typeof data === 'number' || typeof data === 'boolean') {
    return <span style={{ color: '#d9d9d9' }}>{String(data)}</span>;
  }

  if (typeof data !== 'object' || data === null) {
    return <span style={{ color: '#8c8c8c' }}>null</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span style={{ color: '#8c8c8c' }}>[]</span>;
    return (
      <div style={{ paddingLeft: depth > 0 ? 12 : 0, borderLeft: depth > 0 ? '1px solid #303030' : 'none', marginTop: depth > 0 ? 4 : 0 }}>
        {data.map((item, idx) => (
          <div key={idx} style={{ marginBottom: 2 }}>
            <span style={{ color: '#8c8c8c', marginRight: 6 }}>-</span>
            {renderDataTree(item, depth + 1)}
          </div>
        ))}
      </div>
    );
  }

  const keys = Object.keys(data);
  if (keys.length === 0) return <span style={{ color: '#8c8c8c' }}>{'{ }'}</span>;

  return (
    <div style={{ paddingLeft: depth > 0 ? 12 : 0, borderLeft: depth > 0 ? '1px solid #303030' : 'none', marginTop: depth > 0 ? 4 : 0 }}>
      {keys.map(k => (
        <div key={k} style={{ marginBottom: 2 }}>
          <span style={{ color: '#52c41a', fontWeight: 500, marginRight: 6 }}>{k}:</span>
          {renderDataTree(data[k], depth + 1)}
        </div>
      ))}
    </div>
  );
};

/**
 * Renders an accordion list of agent- or user-initiated MCP executions.
 * @param props The CommandFeedProps
 * @returns The rendered React component
 */
export default function CommandFeed({ 
  commands, onOpenTab, activeTabRef, activeWorkspace, hardware, spoolerStates, apiBase, token 
}: CommandFeedProps) {
  const { token: antdToken } = theme.useToken();
  const [isLauncherOpen, setIsLauncherOpen] = useState(false);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>('All Sources');
  
  const getCommandBadgeProps = (cmd: CommandRecord) => {
    const hasRunningTask = cmd.tasks?.some(task => task.status === 'running');
    const isActiveSpooler = cmd.tasks?.some(task => 
      task.type === 'monitor' && 
      Object.values(spoolerStates || {}).some((state: any) => state.taskId === task.taskId)
    );

    if (cmd.status === 'running' || hasRunningTask || isActiveSpooler) {
      const isUploading = cmd.mcpToolName?.toLowerCase().includes('upload');
      return { status: 'processing' as const, color: isUploading ? 'gold' : 'green' };
    }
    if (cmd.status === 'success') return { status: 'default' as const, color: 'blue' };
    if (cmd.status === 'error') return { status: 'error' as const, color: 'red' };
    return { status: 'default' as const, color: 'blue' }; // Default to blue for terminated/other non-error non-running
  };

  const getTaskBadgeProps = (task: TaskRecord) => {
    if (task.status === 'running') {
      return { status: 'processing' as const, color: task.type === 'upload' ? 'gold' : 'green' };
    }
    if (task.status === 'success') return { status: 'default' as const, color: 'blue' };
    if (task.status === 'error') return { status: 'error' as const, color: 'red' };
    return { status: 'default' as const, color: 'blue' };
  };

  const getCommandIcon = (toolName?: string) => {
    if (!toolName) return <ToolOutlined />;
    
    switch (toolName) {
      case 'build_project': return <ToolOutlined />;
      case 'clean_project': return <ClearOutlined />;
      case 'check_project': return <CheckSquareOutlined />;
      case 'run_tests': return <ExperimentOutlined />;
      case 'init_project': return <FolderAddOutlined />;
      case 'get_project_config': return <SettingOutlined />;
      
      case 'upload_firmware': return <CloudUploadOutlined />;
      case 'upload_filesystem': return <HddOutlined />;
      
      case 'list_devices': return <UsbOutlined />;
      case 'get_board_info': return <InfoCircleOutlined />;
      case 'list_boards': return <AppstoreOutlined />;
      case 'start_monitor': return <PlayCircleOutlined />;
      case 'stop_monitor': return <PauseCircleOutlined />;
      case 'query_logs': return <AlignLeftOutlined />;
      
      case 'search_libraries': return <SearchOutlined />;
      case 'install_library': return <DownloadOutlined />;
      case 'update_library': return <SyncOutlined />;
      case 'uninstall_library': return <DeleteOutlined />;
      case 'list_installed_libraries': return <BookOutlined />;
      
      case 'acquire_lock': return <LockOutlined />;
      case 'release_lock': return <UnlockOutlined />;
      case 'get_lock_status': return <KeyOutlined />;
      case 'check_task_status': return <ClockCircleOutlined />;
      case 'reset_server_state': return <PoweroffOutlined />;
      case 'get_dashboard_url': return <GlobalOutlined />;
      case 'system_info': return <DesktopOutlined />;
      
      default:
        // Fallbacks for legacy/unmapped
        const lName = toolName.toLowerCase();
        if (lName.includes('test')) return <ExperimentOutlined />;
        if (lName.includes('check')) return <CheckSquareOutlined />;
        if (lName.includes('upload')) return <CloudUploadOutlined />;
        if (lName.includes('build') || lName.includes('run')) return <ToolOutlined />;
        if (lName.includes('monitor')) return <DashboardOutlined />;
        return <QuestionCircleOutlined />;
    }
  };

  const formatToolName = (toolName: string) => {
    return toolName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const displayedCommands = commands.slice().reverse().filter(cmd => {
    if (showActiveOnly && cmd.status !== 'running' && !cmd.tasks?.some(t => t.status === 'running')) return false;
    
    const cmdSource = cmd.source || 'agent';
    if (sourceFilter === 'Agent' && cmdSource !== 'agent') return false;
    if (sourceFilter === 'Dashboard' && cmdSource !== 'dashboard') return false;
    
    return true;
  });

  const renderCommandPanel = (cmd: CommandRecord) => {
    const isHistorical = cmd.status !== 'running';
    const tasksWithLogs = cmd.tasks?.filter(t => t.logPaths && t.logPaths.length > 0) || [];
    const hasLogs = tasksWithLogs.length > 0;
    
    const panelStyle = isHistorical ? {} : {
      backgroundColor: 'rgba(24, 144, 255, 0.08)',
      borderLeft: '3px solid #1890ff',
      marginBottom: 8,
      borderRadius: 4
    };
    
    return (
      <Panel 
        key={cmd.id} 
        style={panelStyle}
        header={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', paddingRight: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
              <Badge {...getCommandBadgeProps(cmd)} />
              <span style={{ color: isHistorical ? '#989898' : 'inherit', flexShrink: 0 }}>
                {getCommandIcon(cmd.mcpToolName)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 'bold', color: isHistorical ? '#989898' : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cmd.mcpToolName ? formatToolName(cmd.mcpToolName) : 'Legacy Execution'}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', opacity: isHistorical ? 0.5 : 0.8 }}>
                <Tooltip title={cmd.source === 'dashboard' ? "Started by Dashboard" : "Started by Agent"}>
                  {cmd.source === 'dashboard' ? <DesktopOutlined style={{ fontSize: 12, color: '#1890ff' }} /> : <RobotOutlined style={{ fontSize: 12, color: '#1890ff' }} />}
                </Tooltip>
              </div>
            </div>
            
            {hasLogs && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingLeft: 24 }} onClick={e => e.stopPropagation()}>
                {tasksWithLogs.map(task => {
                  const isMonitorLive = task.type === 'monitor' && Object.values(spoolerStates || {}).some((state: any) => state.taskId === task.taskId);
                  const isRunning = task.status === 'running' || isMonitorLive;
                  
                  let buttonClass = 'log-btn-default';
                  if (isRunning) {
                    buttonClass = task.type === 'upload' ? 'log-btn-live-gold' : 'log-btn-live';
                  } else if (task.status === 'success') {
                    buttonClass = 'log-btn-historical'; // blue
                  } else if (task.status === 'error') {
                    buttonClass = 'log-btn-error'; // red
                  }
                  
                  return (
                    <Button 
                      key={task.taskId} 
                      size="small" 
                      type="default"
                      className={buttonClass}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenTab({ commandId: cmd.id, taskId: task.taskId });
                      }}
                      style={{ fontSize: 10, padding: '0 6px', height: 22 }}
                    >
                      {`${task.type.toUpperCase()} LOG`}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        }
      >
        <div style={{ padding: '12px 16px', backgroundColor: antdToken.colorBgElevated, borderRadius: 6, border: `1px solid ${antdToken.colorBorderSecondary}` }}>
          {(!cmd.mcpToolName && !cmd.mcpRequest && !cmd.mcpResponse) ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>Legacy payload structure. Detailed rendering unavailable.</Text>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Divider orientation="left" style={{ margin: '8px 0', borderColor: antdToken.colorBorderSecondary }}>
                <Text strong style={{ color: '#1890ff', fontSize: 11, letterSpacing: 1 }}>MCP LAYER</Text>
              </Divider>
              
              <div style={{ paddingLeft: 12 }}>
                {cmd.error && (
                  <div style={{ marginBottom: 12, padding: '8px 12px', backgroundColor: 'rgba(255, 77, 79, 0.1)', borderLeft: '3px solid #ff4d4f', borderRadius: 4 }}>
                    <div style={{ marginBottom: 4 }}><Text style={{ color: '#ff4d4f', fontSize: 10, letterSpacing: 0.5, fontWeight: 'bold' }}>COMMAND ERROR</Text></div>
                    <Text style={{ fontSize: 11, color: '#ffcccc', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{cmd.error}</Text>
                  </div>
                )}
                
                <div style={{ marginBottom: 4 }}><Text type="secondary" style={{ fontSize: 10, letterSpacing: 0.5 }}>MCP TOOL</Text></div>
                <div style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: 12, color: antdToken.colorText }}>{cmd.mcpToolName || cmd.commandDesc}</Text>
                </div>

                <div style={{ marginBottom: 4 }}><Text type="secondary" style={{ fontSize: 10, letterSpacing: 0.5 }}>MCP PARAMETERS</Text></div>
                <div style={{ marginBottom: 12, fontSize: 11, fontFamily: 'monospace' }}>
                  {cmd.mcpRequest ? renderDataTree(cmd.mcpRequest) : <Text style={{ color: '#8c8c8c' }}>-</Text>}
                </div>
                
                <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text type="secondary" style={{ fontSize: 10, letterSpacing: 0.5 }}>MCP RESPONSE</Text>
                  {cmd.mcpResponse && typeof cmd.mcpResponse === 'object' && (cmd.mcpResponse as any).truncated && (
                    <Text style={{ color: '#d48806', fontSize: 9, fontStyle: 'italic' }}>
                      (Ledger Entry Truncated)
                    </Text>
                  )}
                </div>
                <div style={{ marginBottom: 8, fontSize: 11, fontFamily: 'monospace' }}>
                  {cmd.mcpResponse ? (
                    (typeof cmd.mcpResponse === 'object' && (cmd.mcpResponse as any).truncated) 
                      ? (
                          <div>
                            {renderDataTree((cmd.mcpResponse as any).preview)}
                            <div style={{ color: '#d48806', fontSize: 10, marginTop: 4, fontStyle: 'italic' }}>
                              [Data Truncated]
                            </div>
                          </div>
                        )
                      : renderDataTree(cmd.mcpResponse)
                  ) : <Text style={{ color: '#8c8c8c' }}>-</Text>}
                </div>
              </div>

              <Divider orientation="left" style={{ margin: '16px 0 8px 0', borderColor: antdToken.colorBorderSecondary }}>
                <Text strong style={{ color: '#52c41a', fontSize: 11, letterSpacing: 1 }}>OS / HARDWARE LAYER</Text>
              </Divider>
              
              <div style={{ paddingLeft: 12 }}>
                {(!cmd.tasks || cmd.tasks.length === 0) ? (
                  <Text type="secondary" style={{ fontSize: 11 }}>No child tasks spawned.</Text>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {cmd.tasks.map(task => {
                      const pioCommand = (task as any).commandDesc;
                      const logRef = task.port || (task as any).logFile || 'None';
                      
                      return (
                        <div key={task.taskId} style={{ padding: 12, border: `1px solid ${antdToken.colorBorderSecondary}`, borderRadius: 6, backgroundColor: antdToken.colorBgContainer }}>
                          
                          {task.pid && (
                            <>
                              <div style={{ marginBottom: 4 }}><Text type="secondary" style={{ fontSize: 10, letterSpacing: 0.5 }}>PID</Text></div>
                              <div style={{ marginBottom: 12 }}>
                                <Text style={{ fontSize: 11, fontFamily: 'monospace', color: antdToken.colorText }}>
                                  {task.pid}
                                </Text>
                              </div>
                            </>
                          )}
                          
                          <div style={{ marginBottom: 4 }}><Text type="secondary" style={{ fontSize: 10, letterSpacing: 0.5 }}>PIO COMMAND</Text></div>
                          <div style={{ marginBottom: 12 }}>
                            {pioCommand ? (
                              <Text style={{ fontSize: 11, fontFamily: 'monospace', color: antdToken.colorText }}>
                                {pioCommand.replace('PIO Task: ', 'pio ')}
                              </Text>
                            ) : (
                              <Text type="secondary" style={{ fontSize: 11, fontStyle: 'italic' }}>
                                Legacy Execution
                              </Text>
                            )}
                          </div>
                          
                          <div style={{ marginBottom: 4 }}><Text type="secondary" style={{ fontSize: 10, letterSpacing: 0.5 }}>RESULT</Text></div>
                          <div style={{ marginBottom: task.error ? 8 : 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Badge {...getTaskBadgeProps(task)} />
                            <Text style={{ fontSize: 11, color: antdToken.colorText, textTransform: 'capitalize' }}>
                              {task.status}
                            </Text>
                            {task.exitCode !== undefined && (
                              <Text style={{ fontSize: 11, color: '#8c8c8c' }}>(Exit: {task.exitCode})</Text>
                            )}
                          </div>
                          {task.error && (
                            <div style={{ marginBottom: 12, padding: '6px 10px', backgroundColor: 'rgba(255, 77, 79, 0.05)', borderLeft: '2px solid #ff4d4f', borderRadius: 4 }}>
                              <Text style={{ fontSize: 11, color: '#ffcccc', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{task.error}</Text>
                            </div>
                          )}
                          
                          <div style={{ marginBottom: 4 }}><Text type="secondary" style={{ fontSize: 10, letterSpacing: 0.5 }}>LOG REFERENCE</Text></div>
                          <div>
                            {task.logPaths && task.logPaths.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {task.logPaths.map((path, idx) => (
                                  <Tooltip key={idx} title={path} placement="right">
                                    <a 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenTab({ commandId: cmd.id, taskId: task.taskId });
                                      }}
                                      style={{ fontSize: 11, fontFamily: 'monospace', color: '#1890ff', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                    >
                                      <FileTextOutlined style={{ fontSize: 10 }} />
                                      {path.split('/').pop()}
                                    </a>
                                  </Tooltip>
                                ))}
                              </div>
                            ) : (
                              <Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#1890ff' }}>
                                {logRef}
                              </Text>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${antdToken.colorBorderSecondary}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text type="secondary" style={{ fontSize: 10, letterSpacing: 0.5 }}>DIAGNOSTIC UUID</Text>
                <Text code style={{ fontSize: 11, color: '#8c8c8c', backgroundColor: 'transparent', border: `1px solid ${antdToken.colorBorderSecondary}` }}>{cmd.id}</Text>
              </div>
            </div>
          )}
        </div>
      </Panel>
    );
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text type="secondary" strong style={{ fontSize: 12, letterSpacing: 1 }}>AGENT TASK STREAM</Text>
          <Button 
            type="primary" 
            icon={<PlaySquareOutlined />} 
            onClick={() => setIsLauncherOpen(true)}
            size="small"
          >
            NEW TASK
          </Button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.05)' }}>
            <Switch 
              size="small" 
              checked={showActiveOnly} 
              onChange={setShowActiveOnly} 
            />
            <Text style={{ fontSize: 11, color: showActiveOnly ? '#1890ff' : '#8c8c8c', whiteSpace: 'nowrap' }}>SHOW ACTIVE ONLY</Text>
          </div>
          <div style={{ display: 'flex', padding: '4px', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.05)', width: '100%' }}>
            <Segmented
              className="command-feed-segmented"
              size="small"
              options={['All Sources', 'Agent', 'Dashboard']}
              value={sourceFilter}
              onChange={(value) => setSourceFilter(value as string)}
              block
            />
            <style dangerouslySetInnerHTML={{__html:`
              .command-feed-segmented {
                width: 100%;
                font-size: 11px;
              }
              .command-feed-segmented .ant-segmented-item {
                flex: 1;
                min-width: 0;
              }
              .command-feed-segmented .ant-segmented-item-label {
                padding: 0 4px;
                text-overflow: clip;
              }
            `}} />
          </div>
        </div>
      </div>

      <CommandLauncher 
        isOpen={isLauncherOpen} 
        onClose={() => setIsLauncherOpen(false)} 
        activeWorkspace={activeWorkspace || null}
        hardware={hardware || []}
        apiBase={apiBase || ''}
        token={token || ''}
      />

      <div style={{ marginTop: 12 }}>
        <Collapse defaultActiveKey={[]} ghost expandIconPosition="start" className="command-feed-collapse">
          {displayedCommands.map(cmd => renderCommandPanel(cmd))}
        </Collapse>
      </div>
    </div>
  );
}
