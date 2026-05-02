import React, { useState, useEffect } from 'react';
import { Card, Button, Typography, Spin, Empty, List, Tag, Space, theme } from 'antd';
import { CodeSandboxOutlined, ExportOutlined } from '@ant-design/icons';
import type { LockState } from '../app.js';

const { Text, Paragraph } = Typography;

interface DependenciesViewerProps {
  apiBase: string;
  token: string;
  activeWorkspace: string | null;
  lockState: LockState;
}

export default function DependenciesViewer({ 
  apiBase, 
  token, 
  activeWorkspace,
  lockState
}: DependenciesViewerProps) {
  const [installedLibs, setInstalledLibs] = useState<any[]>([]);
  const [isFetchingInstalled, setIsFetchingInstalled] = useState(false);
  const [loadingPioHome, setLoadingPioHome] = useState(false);
  const { token: antdToken } = theme.useToken();

  const fetchInstalledInfo = async () => {
    if (!activeWorkspace) return;
    setIsFetchingInstalled(true);
    try {
      const res = await fetch(`${apiBase}/api/libraries/installed?projectDir=${encodeURIComponent(activeWorkspace)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const libs = await res.json();
        setInstalledLibs(libs || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsFetchingInstalled(false);
    }
  };

  useEffect(() => {
    fetchInstalledInfo();
  }, [activeWorkspace]);

  const handleLaunchPioHome = async () => {
    if (!activeWorkspace) return;
    setLoadingPioHome(true);
    try {
      await fetch(`${apiBase}/api/commands/pio_home`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ projectDir: activeWorkspace })
      });
      setTimeout(() => {
        window.open('http://127.0.0.1:8008/', '_blank');
      }, 1000);
    } catch(e) {
      console.error("Failed to launch PIO Home", e);
    } finally {
      setTimeout(() => setLoadingPioHome(false), 1500); 
    }
  };

  return (
    <Card 
      title={<Space><CodeSandboxOutlined /> <Text strong>DEPENDENCIES VIEWER</Text></Space>}
      size="small"
      extra={
        activeWorkspace && (
          <Button 
            type="default" 
            size="small" 
            icon={<ExportOutlined />}
            loading={loadingPioHome}
            disabled={lockState.isLocked}
            onClick={handleLaunchPioHome}
          >
            MANAGE IN PIO HOME
          </Button>
        )
      }
      styles={{ header: { backgroundColor: antdToken.colorBgElevated } }}
    >
      <Paragraph type="secondary" style={{ fontSize: '12px' }}>
        Library mutations are disabled in this read-only view. Please manage your workspace dependencies using the Native PlatformIO dashboard.
      </Paragraph>
      
      {!activeWorkspace ? (
         <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text type="secondary">AWAITING WORKSPACE CONTEXT</Text>} />
      ) : isFetchingInstalled ? (
         <div style={{ textAlign: 'center', padding: '20px' }}><Spin tip="Syncing Telemetry..." /></div>
      ) : installedLibs.length === 0 ? (
         <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text type="secondary">NO INSTALLED LIBRARIES</Text>} />
      ) : (
        <List
          itemLayout="horizontal"
          dataSource={installedLibs}
          renderItem={(lib) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Space>
                    <Text strong>{lib.name}</Text>
                    {lib.version && <Tag color="green">v{lib.version}</Tag>}
                  </Space>
                }
                description={lib.description || 'No description available'}
              />
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}
