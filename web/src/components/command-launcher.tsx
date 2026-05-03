import React, { useState, useEffect } from 'react';
import { Modal, Form, Select, Switch, Button, message } from 'antd';
import { CodeOutlined } from '@ant-design/icons';

interface CommandLauncherProps {
  isOpen: boolean;
  onClose: () => void;
  activeWorkspace: string | null;
  hardware: any[];
  apiBase: string;
  token: string;
}

export default function CommandLauncher({ isOpen, onClose, activeWorkspace, hardware, apiBase, token }: CommandLauncherProps) {
  const [form] = Form.useForm();
  const [action, setAction] = useState('build_project');
  const [loading, setLoading] = useState(false);
  const [isFetchingConfig, setIsFetchingConfig] = useState(false);
  const [environments, setEnvironments] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen && activeWorkspace) {
      form.resetFields();
      form.setFieldsValue({ action: 'build_project' });
      setAction('build_project');
      const fetchConfig = async () => {
        try {
          const res = await fetch(`${apiBase}/api/projects/config?projectDir=${encodeURIComponent(activeWorkspace)}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const payload = await res.json();
            if (Array.isArray(payload)) {
              // Parse PIO config JSON format: [["env:esp32dev", [...]], ["platformio", [...]]]
              const envs = payload
                .filter((section: any) => Array.isArray(section) && section.length > 0 && typeof section[0] === 'string' && section[0].startsWith('env:'))
                .map((section: any) => section[0].replace('env:', ''));
              
              setEnvironments(envs);
            } else if (payload && payload.rawConfig) {
              // Fallback for legacy rawConfig
              const matches = Array.from(payload.rawConfig.matchAll(/\[env:([^\]]+)\]/g));
              const envs = matches.map((m: any) => m[1]);
              setEnvironments(envs);
            }
          }
        } catch (e) {
          console.error(e);
        } finally {
          setIsFetchingConfig(false);
        }
      };
      setIsFetchingConfig(true);
      fetchConfig();
    }
  }, [isOpen, activeWorkspace, apiBase, token, form]);

  const handleExecute = async () => {
    if (!activeWorkspace) return;
    try {
      const values = await form.validateFields();
      setLoading(true);
      
      const actionPath = values.action === 'build_project' ? 'build' : values.action;
      const endpoint = `/api/commands/${actionPath}`;
      const payload: any = { projectDir: activeWorkspace };

      if (values.environment) payload.environment = values.environment;
      if (values.port) payload.port = values.port;
      if (values.verbose !== undefined) payload.verbose = values.verbose;
      if (values.start_monitor !== undefined) payload.start_monitor = values.start_monitor;

      const res = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
         const data = await res.json();
         message.error(`Failed: ${data.error}`);
      }
      onClose();
    } catch(e: any) {
      if (e.errorFields) return; // Validation failed
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const hasEnv = ['build_project', 'upload_firmware', 'upload_filesystem', 'run_tests', 'check_project'].includes(action);
  const hasPort = ['upload_firmware', 'upload_filesystem'].includes(action);
  const hasVerbose = ['build_project', 'upload_firmware'].includes(action);
  const hasStartMonitor = ['upload_firmware'].includes(action);

  return (
    <Modal
      title={<><CodeOutlined /> LAUNCH NEW COMMAND</>}
      open={isOpen}
      onCancel={onClose}
      onOk={handleExecute}
      confirmLoading={loading}
      okText="EXECUTE"
      cancelText="CANCEL"
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ action: 'build_project' }}>
        <Form.Item name="action" label="ACTION VERB" rules={[{ required: true }]}>
          <Select onChange={(val) => setAction(val)}>
            <Select.Option value="build_project">BUILD PROJECT</Select.Option>
            <Select.Option value="upload_firmware">UPLOAD FIRMWARE</Select.Option>
            <Select.Option value="upload_filesystem">UPLOAD FILESYSTEM</Select.Option>
            <Select.Option value="run_tests">RUN UNIT TESTS</Select.Option>
            <Select.Option value="check_project">CHECK PROJECT (STATIC ANALYSIS)</Select.Option>
            <Select.Option value="clean">CLEAN ARTIFACTS</Select.Option>
          </Select>
        </Form.Item>

        {hasEnv && (
          <Form.Item name="environment" label="TARGET ENVIRONMENT">
            <Select 
              allowClear 
              placeholder="Auto-Detect / Default"
              loading={isFetchingConfig}
              popupClassName="target-environment-dropdown"
            >
              {environments.length === 0 && <Select.Option value="">Auto-Detect / Default</Select.Option>}
              {environments.map(e => <Select.Option key={e} value={e}>{e}</Select.Option>)}
            </Select>
          </Form.Item>
        )}

        {hasPort && (
          <Form.Item name="port" label="HARDWARE PORT">
            <Select allowClear placeholder="Auto-Detect Port">
              {hardware.map(h => <Select.Option key={h.port} value={h.port}>{h.port} - {h.hwid}</Select.Option>)}
            </Select>
          </Form.Item>
        )}

        {hasVerbose && (
          <Form.Item name="verbose" label="Verbose Output" valuePropName="checked">
            <Switch />
          </Form.Item>
        )}

        {hasStartMonitor && (
          <Form.Item name="start_monitor" label="Start Monitor after Upload" valuePropName="checked">
            <Switch />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
