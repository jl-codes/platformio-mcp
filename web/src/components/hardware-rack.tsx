import React, { useState } from 'react';
import { Card, Button, Badge, Tooltip, Typography, Tag, Space, Divider, message, theme } from 'antd';
import { 
  UsbOutlined, 
  PlayCircleOutlined, 
  StopOutlined,
  DashboardOutlined,
  LinkOutlined,
  ApiOutlined,
  CodeOutlined
} from '@ant-design/icons';

const { Text } = Typography;

interface PortClaim {
  type: string;
  owner_workspace: string;
  owner_pid: number;
  timestamp: number;
}

export interface HardwareDevice {
  port: string;
  description: string;
  hwid: string;
  detectedBoard?: string;
  claim?: PortClaim;
}

interface HardwareRackProps {
  hardware: HardwareDevice[];
  activeWorkspace: string | null;
  apiBase: string;
  token: string;
  onOpenTab?: (port: string) => void;
}

export default function HardwareRack({ hardware, activeWorkspace, apiBase, token, onOpenTab }: HardwareRackProps) {
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const { token: antdToken } = theme.useToken();

  const toggleMonitor = async (device: HardwareDevice) => {
    const isMonitoring = device.claim?.type === 'monitor';
    const port = device.port;
    const endpoint = isMonitoring ? '/api/spooler/stop' : '/api/spooler/start';
    
    setLoadingMap(prev => ({ ...prev, [port]: true }));
    try {
      const res = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ port, projectDir: activeWorkspace })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        message.error(`Failed: ${errorData.error || res.statusText}`);
      }
    } catch (e: any) {
      console.error(e);
      message.error(`Network Error: ${e.message}`);
    } finally {
      setLoadingMap(prev => ({ ...prev, [port]: false }));
    }
  };

  const getBadgeProps = (device: HardwareDevice) => {
    const { claim, detectedBoard } = device;
    if (!claim) {
      if (detectedBoard || (device.hwid && device.hwid !== 'n/a')) {
        return { color: 'blue', text: 'Connected' };
      }
      return { status: 'default' as const, text: 'Disconnected' };
    }
    if (claim.type === 'monitor') {
      return { status: 'processing' as const, color: 'green', text: 'Monitoring' };
    }
    if (claim.type === 'upload') {
      return { status: 'processing' as const, color: 'gold', text: 'Uploading' };
    }
    return { status: 'error' as const, text: 'Locked' };
  };

  if (!hardware || hardware.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <Text type="secondary">No Hardware Devices Detected</Text>
      </div>
    );
  }

  return (
    <div style={{ 
      display: 'flex', 
      gap: 16, 
      padding: 16, 
      overflowX: 'auto',
      height: '100%',
      alignItems: 'flex-start'
    }}>
      {hardware.map(device => {
        const badge = getBadgeProps(device);
        const isMonitoring = device.claim?.type === 'monitor';
        const isLocked = device.claim && device.claim.type !== 'monitor';
        const isLoading = loadingMap[device.port];
        const portName = device.port.split('/').pop() || device.port;

        const isDisconnected = badge.text === 'Disconnected';
        const isConnected = badge.text === 'Connected';

        return (
          <Card 
            key={device.port}
            size="small"
            style={{ 
              width: 320, 
              flexShrink: 0,
              backgroundColor: antdToken.colorBgContainer,
              borderColor: antdToken.colorBorderSecondary,
              boxShadow: '0 6px 16px -8px rgba(0,0,0,0.4), 0 9px 28px 0 rgba(0,0,0,0.3)',
              borderRadius: 8
            }}
            title={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Space>
                  <UsbOutlined style={{ color: badge.color === 'blue' ? '#1677ff' : badge.color === 'green' ? '#52c41a' : badge.color === 'gold' ? '#faad14' : badge.status === 'error' ? '#ff4d4f' : '#8c8c8c' }} />
                  <Text strong ellipsis style={{ maxWidth: 150 }}>{portName}</Text>
                </Space>
                <Badge status={badge.status} color={badge.color} text={<span style={{ fontSize: 12 }}>{badge.text}</span>} />
              </div>
            }
            actions={[
              <Tooltip key="toggle" title={isMonitoring ? 'Stop Serial Monitor' : (isLocked ? 'Port Locked by Another Process' : (isDisconnected ? 'Device Disconnected' : 'Start Serial Monitor'))}>
                <Button 
                  type={isMonitoring ? 'primary' : 'default'}
                  danger={isMonitoring}
                  icon={isMonitoring ? <StopOutlined /> : <PlayCircleOutlined />}
                  onClick={() => toggleMonitor(device)}
                  loading={isLoading}
                  disabled={!!isLocked || isDisconnected}
                  block
                  style={{ 
                    border: 'none', 
                    background: 'transparent', 
                    boxShadow: 'none', 
                    color: isMonitoring ? undefined : (isConnected ? antdToken.colorPrimary : undefined) 
                  }}
                >
                  {isMonitoring ? 'Stop Monitor' : 'Start Monitor'}
                </Button>
              </Tooltip>,
              <Tooltip key="view" title={device.claim ? "View Logs" : "No Active Logs"}>
                <Button 
                  type="default"
                  icon={<CodeOutlined />}
                  onClick={() => onOpenTab && onOpenTab(device.port)}
                  block
                  disabled={!device.claim}
                  style={{ border: 'none', background: 'transparent', boxShadow: 'none' }}
                >
                  Logs
                </Button>
              </Tooltip>
            ]}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: 130 }}>
              
              <div style={{ flex: 1 }}>
                <Text type="secondary" style={{ fontSize: 10, letterSpacing: 1 }}>DEVICE INFO</Text>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 4 }}>
                  {device.detectedBoard ? (
                    <ApiOutlined style={{ marginTop: 4, color: '#52c41a' }} />
                  ) : (
                    <LinkOutlined style={{ marginTop: 4, color: '#8c8c8c' }} />
                  )}
                  <Text style={{ fontSize: 13, lineHeight: 1.4, color: (device.detectedBoard || (device.hwid && device.hwid !== 'n/a')) ? '#1677ff' : undefined }}>
                    {device.detectedBoard ? `Board: ${device.detectedBoard}` : device.description}
                  </Text>
                </div>
              </div>

              <Divider style={{ margin: '4px 0' }} />
              <div>
                <Text type="secondary" style={{ fontSize: 10, letterSpacing: 1 }}>PROCESS ATTACHED</Text>
                <div style={{ marginTop: 4 }}>
                  {device.claim ? (
                    <Tag icon={<DashboardOutlined />} color="blue" style={{ border: 'none' }}>
                      PID: {device.claim.owner_pid}
                    </Tag>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>None</Text>
                  )}
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
