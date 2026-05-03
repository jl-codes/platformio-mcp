import React, { useState } from 'react';
import { Layout, Menu, Drawer, Button, Space, Badge, Dropdown, Switch, Typography, Modal, message, theme } from 'antd';
import { CodeOutlined, InfoCircleOutlined, UsbOutlined, PoweroffOutlined, FolderOpenOutlined, ApiOutlined, LinkOutlined, UpOutlined, DownOutlined, HomeOutlined } from '@ant-design/icons';
import { AgentEvent, LogEvent, SpoolerState, LockState, TabRef } from '../app.js';
import CommandFeed from './command-feed.js';
import IDEWorkspace from './ide-workspace.js';
import HardwareRack from './hardware-rack.js';
import WorkspaceConfig from './workspace-config.js';
import ThemeSelector from './theme-selector.js';

const { Header, Sider, Content } = Layout;

interface WorkspaceCockpitProps {
  status: 'online' | 'offline';
  commands: any[];
  buildLogs: Record<string, LogEvent[]>;
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
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
  knownWorkspaces?: string[];
  setActiveWorkspace?: (ws: string) => void;
  autoTrack?: boolean;
  setAutoTrack?: (val: boolean) => void;
}

const { Text } = Typography;

export default function WorkspaceCockpit({
  status, commands, buildLogs, buildLogFile, serialLogs, spoolerStates,
  activeWorkspace, lockState, openTabs, setOpenTabs, activeTabRef, setActiveTabRef,
  historicalLogBuffer, hardware = [], apiBase, token, isDarkMode, setIsDarkMode,
  knownWorkspaces = [], setActiveWorkspace, autoTrack = true, setAutoTrack
}: WorkspaceCockpitProps) {
  
  const [activeMenu, setActiveMenu] = useState('agent-stream');
  const [isHardwareRackOpen, setIsHardwareRackOpen] = useState(false);
  const { token: antdToken } = theme.useToken();

  const handleOpenTab = (tab: TabRef) => {
    if (!openTabs.find(t => t.taskId === tab.taskId)) {
      setOpenTabs([...openTabs, tab]);
    }
    setActiveTabRef(tab);
  };

  const handleResetServer = () => {
    Modal.confirm({
      title: 'Reset Server State',
      content: 'This will forcefully clean all server locks, terminate tracked processes, and clear the global cache. Proceed?',
      okText: 'Reset',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          const res = await fetch(`${apiBase}/api/server/reset`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ projectDir: activeWorkspace })
          });
          const data = await res.json();
          if (data.success) {
            message.success(data.message);
          } else {
            message.error(data.error);
          }
        } catch (e: any) {
          message.error(`Failed to reset: ${e.message}`);
        }
      }
    });
  };

  const handleOpenProject = async () => {
    try {
      const res = await fetch(`${apiBase}/api/workspaces/browse`, { 
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.path && setActiveWorkspace) {
        setActiveWorkspace(data.path);
        message.success(`Tracking workspace: ${data.path}`);
      } else if (data.error) {
        message.error(data.error);
      }
    } catch (e: any) {
      message.error(`System error: ${e.message}`);
    }
  };

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {/* Top Global Header */}
      <Header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 24px 0 0', borderBottom: '1px solid rgba(144, 143, 160, 0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', height: '100%', gap: '24px' }}>
          {/* Logo container: 64px width exactly matches the Sider width below */}
          <div style={{ width: '64px', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <img src="/pio_mcp_220x220.png" alt="PIO MCP" style={{ height: '40px', width: '40px', objectFit: 'contain' }} />
          </div>
          
          <span className="mono-label" style={{ color: '#4080D0', fontSize: '22px', fontWeight: 'bold' }}>
            PLATFORMIO MCP
          </span>

          <Dropdown
            menu={{
              items: [
                ...knownWorkspaces.map(ws => ({ key: ws, label: <span className="mono-label" style={{ fontSize: '12px' }}>{ws.split('/').filter(Boolean).pop()}</span> })),
                { type: 'divider', key: 'div1' },
                { key: 'open-project', icon: <FolderOpenOutlined />, label: 'Open Project' }
              ],
              onClick: (e) => {
                if (e.key === 'open-project') {
                  handleOpenProject();
                } else {
                  setActiveWorkspace?.(e.key);
                }
              }
            }}
            trigger={['click']}
          >
            <Button style={{ fontFamily: 'Fira Code', width: '280px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeWorkspace ? activeWorkspace.split('/').filter(Boolean).pop() : 'No Project Selected'}
              </span>
              <DownOutlined style={{ fontSize: '10px', color: '#8c8c8c' }} />
            </Button>
          </Dropdown>
          
          <Space align="center">
            <Switch checked={autoTrack} onChange={setAutoTrack} size="small" />
            <Text type="secondary" style={{ fontSize: 11, letterSpacing: 0.5, margin: 0 }}>AUTO-TRACK</Text>
          </Space>
        </div>
        
        <Space align="center">
          <Badge status={status === 'online' ? 'success' : 'error'} text={<span className="mono-label" style={{ color: 'inherit' }}>SERVER: {status.toUpperCase()}</span>} />
          <ThemeSelector isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />
        </Space>
      </Header>

      <Layout>
        {/* The 64px Thin Activity Bar */}
        <Sider width={64} collapsed={true} collapsedWidth={64} theme={isDarkMode ? 'dark' : 'light'} style={{ borderRight: '1px solid rgba(144, 143, 160, 0.2)' }}>
          <Menu 
            theme={isDarkMode ? 'dark' : 'light'} 
            mode="vertical" 
            selectedKeys={[activeMenu]}
            onClick={(e) => {
              if (e.key === 'hardware') {
                setIsHardwareRackOpen(!isHardwareRackOpen);
              } else if (e.key === 'reset-server') {
                handleResetServer();
              } else if (e.key === 'pio-home') {
                fetch(`${apiBase}/api/commands/pio_home`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                  },
                  body: JSON.stringify({ projectDir: activeWorkspace })
                }).catch(err => console.error("Failed to start PIO Home", err));
                setTimeout(() => {
                  window.open('http://127.0.0.1:8008/', '_blank');
                }, 1000);
              } else {
                setActiveMenu(e.key);
              }
            }}
            items={[
              { key: 'agent-stream', icon: <CodeOutlined />, title: 'Agent Task Stream' },
              { key: 'project-info', icon: <InfoCircleOutlined />, title: 'Project Info' },
              { key: 'pio-home', icon: <HomeOutlined />, title: 'PIO Home' },
              { key: 'reset-server', icon: <PoweroffOutlined style={{ color: '#ff4d4f' }} />, title: 'Reset Server State', style: { position: 'absolute', bottom: 80 } },
              { key: 'hardware', icon: <UsbOutlined />, title: 'Hardware Rack', style: { position: 'absolute', bottom: 16 } }
            ]}
            style={{ height: '100%', borderRight: 0 }}
          />
          <style dangerouslySetInnerHTML={{__html:`
            .ant-menu-item {
              height: 64px !important;
              width: 64px !important;
              margin-block: 0 !important;
              margin-inline: 0 !important;
              padding: 0 !important;
              display: flex;
              justify-content: center;
              align-items: center;
              border-radius: 0 !important;
            }
            .ant-menu-item .anticon {
              font-size: 24px !important;
            }
          `}} />
        </Sider>

        {/* Dynamic Main Viewport */}
        <Content style={{ display: 'flex', overflow: 'hidden' }}>
          {activeMenu === 'agent-stream' ? (
            <>
              {/* Agent Task Stream Master */}
              <div style={{ width: 320, borderRight: '1px solid rgba(144, 143, 160, 0.2)', overflowY: 'auto' }}>
                <CommandFeed 
                  commands={commands} 
                  activeTabRef={activeTabRef}
                  onOpenTab={handleOpenTab}
                  activeWorkspace={activeWorkspace}
                  hardware={hardware}
                  spoolerStates={spoolerStates}
                  apiBase={apiBase}
                  token={token}
                />
              </div>
              
              {/* Agent Task Stream Detail */}
              <div style={{ flex: 1, overflow: 'hidden' }}>
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
              </div>
            </>
          ) : (
            <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
              <WorkspaceConfig 
                activeWorkspace={activeWorkspace}
                lockState={lockState}
                apiBase={apiBase}
                token={token}
              />
            </div>
          )}
        </Content>
      </Layout>

      {/* Compact View Hardware Strip (Visible when Drawer is closed) */}
      {!isHardwareRackOpen && (() => {
        const getHardwareStripBadge = (device: any) => {
          const { claim, detectedBoard } = device;
          if (!claim) {
            if (detectedBoard || (device.hwid && device.hwid !== 'n/a')) {
              return { color: 'blue' };
            }
            return { status: 'default' as const };
          }
          if (claim.type === 'monitor') return { status: 'processing' as const, color: 'green' };
          if (claim.type === 'upload') return { status: 'processing' as const, color: 'gold' };
          return { status: 'error' as const };
        };

        return (
        <div 
          onClick={() => setIsHardwareRackOpen(true)}
          style={{ height: '32px', backgroundColor: antdToken.colorBgElevated, borderTop: '1px solid rgba(144, 143, 160, 0.2)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: '16px', overflowX: 'auto', flexShrink: 0, cursor: 'pointer' }}
        >
          <Button 
            type="text" 
            icon={<UpOutlined style={{ fontSize: 10, color: '#8c8c8c' }} />} 
            size="small" 
            style={{ minWidth: 24, padding: 0, pointerEvents: 'none' }}
          />
          <Text type="secondary" style={{ fontSize: 10, letterSpacing: 1 }}>ACTIVE PORTS:</Text>
          {hardware.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 10 }}>None</Text>
          ) : (
            hardware.map((dev, i) => {
              const isBusy = !!dev.claim;
              return (
                <div key={i} style={{ 
                  display: 'flex', alignItems: 'center', gap: '6px', 
                  backgroundColor: antdToken.colorBgContainer, padding: '2px 8px', 
                  borderRadius: '4px', border: `1px solid ${antdToken.colorBorderSecondary}` 
                }}>
                  <Badge {...getHardwareStripBadge(dev)} />
                  {dev.detectedBoard ? (
                    <ApiOutlined style={{ fontSize: 12, color: '#52c41a' }} />
                  ) : (
                    <LinkOutlined style={{ fontSize: 12, color: '#8c8c8c' }} />
                  )}
                  <span style={{ fontSize: '10px', color: antdToken.colorText, fontFamily: 'monospace' }}>
                    {dev.port.split('/').pop()}
                  </span>
                </div>
              );
            })
          )}
        </div>
        );
      })()}

      {/* Globally Persistent Bottom Container for Hardware Rack */}
      {isHardwareRackOpen && (
        <div style={{ 
          backgroundColor: antdToken.colorBgElevated, 
          borderTop: '1px solid rgba(144, 143, 160, 0.2)', 
          display: 'flex', 
          flexDirection: 'column', 
          flexShrink: 0, 
          zIndex: 10
        }}>
          <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '16px', borderBottom: '1px solid rgba(144, 143, 160, 0.2)', backgroundColor: antdToken.colorBgContainer }}>
            <Button type="text" icon={<DownOutlined style={{ color: '#8c8c8c' }} />} size="small" onClick={() => setIsHardwareRackOpen(false)} style={{ minWidth: 24, padding: 0 }} />
            <Text className="mono-label" style={{ fontWeight: 'bold', color: antdToken.colorText }}>HARDWARE RACK</Text>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <HardwareRack 
              hardware={hardware} 
              activeWorkspace={activeWorkspace}
              apiBase={apiBase}
              token={token}
              onOpenTab={(port) => {
                 const device = hardware.find(d => d.port === port);
                 if (!device || !device.claim) return;
                 if (device.claim.type === 'monitor') {
                   const sState = spoolerStates[port] as any;
                   const tId = sState?.taskId || port;
                   handleOpenTab({ commandId: 'hardware-rack', taskId: tId });
                 } else {
                   const cmd = commands.find(c => c.tasks?.some((t: any) => t.pid === device.claim.owner_pid));
                   if (cmd) {
                     const task = cmd.tasks.find((t: any) => t.pid === device.claim.owner_pid);
                     if (task) {
                       handleOpenTab({ commandId: cmd.id, taskId: task.taskId });
                     }
                   }
                 }
              }}
            />
          </div>
        </div>
      )}

    </Layout>
  );
}
