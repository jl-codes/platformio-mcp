import React, { useState, useEffect } from 'react';
import { Card, Typography, Spin, Space, Tag, Empty, theme, Row, Col, Descriptions } from 'antd';
import { AppstoreOutlined, SettingOutlined, DesktopOutlined, ProjectOutlined } from '@ant-design/icons';
import DependenciesViewer from './dependencies-viewer.js';
import SafetyPolicyOverview from './safety-policy-overview.js';
import type { LockState } from '../app.js';

const { Text } = Typography;

interface WorkspaceConfigProps {
  apiBase: string;
  token: string;
  activeWorkspace: string | null;
  lockState: LockState;
}

export default function WorkspaceConfig({ 
  apiBase, 
  token, 
  activeWorkspace,
  lockState
}: WorkspaceConfigProps) {
  const [environments, setEnvironments] = useState<any[]>([]);
  const [isFetchingEnv, setIsFetchingEnv] = useState(false);
  
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [isFetchingSys, setIsFetchingSys] = useState(false);
  const [safetyOverview, setSafetyOverview] = useState<any>(null);
  const [isFetchingSafety, setIsFetchingSafety] = useState(false);
  const [safetyRefreshKey, setSafetyRefreshKey] = useState(0);

  const { token: antdToken } = theme.useToken();

  useEffect(() => {
    const fetchSysInfo = async () => {
      setIsFetchingSys(true);
      try {
        let url = `${apiBase}/api/system/info`;
        if (activeWorkspace) url += `?projectDir=${encodeURIComponent(activeWorkspace)}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const payload = await res.json();
          setSystemInfo(payload);
        }
      } catch (e) {
        console.error("Failed to fetch system info", e);
      } finally {
        setIsFetchingSys(false);
      }
    };
    fetchSysInfo();
  }, [apiBase, token, activeWorkspace]);

  useEffect(() => {
    const fetchConfig = async () => {
      if (!activeWorkspace) {
        setEnvironments([]);
        return;
      }
      setIsFetchingEnv(true);
      try {
        const res = await fetch(`${apiBase}/api/projects/config?projectDir=${encodeURIComponent(activeWorkspace)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const payload = await res.json();
          if (Array.isArray(payload)) {
            const envs = payload
              .filter((block: any) => Array.isArray(block) && typeof block[0] === 'string' && block[0].startsWith('env:'))
              .map((block: any) => {
                const envName = block[0].replace('env:', '');
                const props = Array.isArray(block[1]) ? block[1] : [];
                const board = props.find((p: any) => p[0] === 'board')?.[1];
                const framework = props.find((p: any) => p[0] === 'framework')?.[1];
                const platform = props.find((p: any) => p[0] === 'platform')?.[1];
                return { name: envName, board, framework, platform };
              });
            setEnvironments(envs);
          } else if (payload && payload.rawConfig) {
             const matches = Array.from(payload.rawConfig.matchAll(/\[env:([^\]]+)\]/g));
             const envs = matches.map((m: any) => ({ name: m[1] }));
             setEnvironments(envs);
          }
        }
      } catch (e) {
        console.error("Failed to fetch project config", e);
      } finally {
        setIsFetchingEnv(false);
      }
    };
    fetchConfig();
  }, [activeWorkspace, apiBase, token]);

  useEffect(() => {
    const fetchSafety = async () => {
      setIsFetchingSafety(true);
      try {
        let url = `${apiBase}/api/safety/overview`;
        if (activeWorkspace) {
          url += `?projectDir=${encodeURIComponent(activeWorkspace)}`;
        }
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const payload = await res.json();
          setSafetyOverview(payload);
        }
      } catch (e) {
        console.error("Failed to fetch safety overview", e);
      } finally {
        setIsFetchingSafety(false);
      }
    };

    fetchSafety();
  }, [activeWorkspace, apiBase, token, safetyRefreshKey]);

  return (
    <div style={{ padding: '16px', maxWidth: '1400px', margin: '0 auto' }}>
      <Row gutter={[24, 24]}>
        {/* Core System Info Panel */}
        <Col xs={24} md={8}>
          <Card 
            title={<Space><DesktopOutlined /> <Text strong>SYSTEM TELEMETRY</Text></Space>}
            size="small"
            styles={{ header: { backgroundColor: antdToken.colorBgElevated }, body: { height: '100%' } }}
            style={{ height: '100%' }}
          >
            {isFetchingSys ? (
              <div style={{ textAlign: 'center', padding: '20px' }}><Spin tip="Loading telemetry..." /></div>
            ) : !systemInfo ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text type="secondary">UNABLE TO FETCH TELEMETRY</Text>} />
            ) : (
              <Descriptions column={1} size="small" labelStyle={{ color: antdToken.colorTextSecondary }}>
                <Descriptions.Item label="PIO Core">{systemInfo.core_version?.value || 'Unknown'}</Descriptions.Item>
                <Descriptions.Item label="Python">{systemInfo.python_version?.value || 'Unknown'}</Descriptions.Item>
                <Descriptions.Item label="System OS">{systemInfo.system?.value || 'Unknown'}</Descriptions.Item>
                <Descriptions.Item label="Global Libs">{systemInfo.global_lib_nums?.value ?? 'Unknown'}</Descriptions.Item>
              </Descriptions>
            )}
          </Card>
        </Col>

        {/* Workspace Environments Panel */}
        <Col xs={24} md={16}>
          <Card 
            title={<Space><ProjectOutlined /> <Text strong>WORKSPACE ENVIRONMENTS</Text></Space>}
            size="small"
            styles={{ header: { backgroundColor: antdToken.colorBgElevated }, body: { height: '100%' } }}
            style={{ height: '100%' }}
          >
            {isFetchingEnv ? (
              <div style={{ textAlign: 'center', padding: '20px' }}><Spin tip="Loading environments..." /></div>
            ) : !activeWorkspace ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text type="secondary">NO WORKSPACE ROOT DETECTED</Text>} />
            ) : environments.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text type="secondary">NO ENVIRONMENTS DETECTED</Text>} />
            ) : (
              <Row gutter={[16, 16]}>
                {environments.map(env => (
                  <Col xs={24} sm={12} lg={8} key={env.name}>
                    <Card size="small" type="inner" title={<Tag color="blue" icon={<AppstoreOutlined />} style={{ margin: 0 }}>{env.name}</Tag>} style={{ height: '100%', borderColor: antdToken.colorBorderSecondary }}>
                      <Descriptions column={1} size="small" labelStyle={{ color: antdToken.colorTextSecondary }}>
                        <Descriptions.Item label="Platform">{env.platform || 'N/A'}</Descriptions.Item>
                        <Descriptions.Item label="Board">{env.board || 'N/A'}</Descriptions.Item>
                        <Descriptions.Item label="Framework">{env.framework || 'N/A'}</Descriptions.Item>
                      </Descriptions>
                    </Card>
                  </Col>
                ))}
              </Row>
            )}
          </Card>
        </Col>

        {/* Dependencies Viewer Panel */}
        <Col span={24}>
          <DependenciesViewer 
            apiBase={apiBase}
            token={token}
            activeWorkspace={activeWorkspace}
            lockState={lockState}
          />
        </Col>

        {/* Safety / Diagnostics Panel */}
        <Col span={24}>
          <SafetyPolicyOverview
            payload={safetyOverview}
            loading={isFetchingSafety}
            apiBase={apiBase}
            token={token}
            onActionComplete={() => setSafetyRefreshKey((prev) => prev + 1)}
          />
        </Col>
      </Row>
    </div>
  );
}
