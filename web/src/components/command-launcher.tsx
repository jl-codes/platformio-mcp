/** Launch authorized dashboard commands with action-specific project and execution options. */
import { dashboardActionFetch } from "../lib/dashboard-action";
import React, { useState, useEffect } from 'react';
import { Modal, Form, Select, Switch, Input, InputNumber, message } from 'antd';
import { CodeOutlined } from '@ant-design/icons';

/**
 * Command Launcher Component
 * Provides a UI modal for agents or users to manually dispatch PlatformIO tasks.
 *
 * Provides:
 * - CommandLauncher: React component for the task dispatch modal.
 * - CommandLauncherProps: Props interface for the CommandLauncher component.
 */

/**
 * Props for the CommandLauncher component.
 */
export interface CommandLauncherProps {
  isOpen: boolean; // Controls modal visibility
  onClose: () => void; // Callback to close the modal
  activeWorkspace: string | null; // The currently targeted project directory
  hardware: any[]; // List of available hardware ports
  apiBase: string; // Base URL for the MCP API
  token: string; // Authentication token for the API
}

/**
 * Renders a modal interface to execute PlatformIO commands against the active workspace.
 * @param props The CommandLauncherProps
 * @returns The rendered React modal component
 */
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
      if (["upload_firmware", "upload_filesystem"].includes(values.action) && values.port) payload.port = values.port;
      if (["build_project", "upload_firmware"].includes(values.action) && values.verbose !== undefined) payload.verbose = values.verbose;
      if (values.action === "upload_firmware" && values.start_monitor !== undefined) payload.start_monitor = values.start_monitor;
      if (values.action === "build_project" && values.jobs != null) payload.jobs = values.jobs;
      if (values.action === "clean" && values.full !== undefined) payload.full = values.full;
      if (values.action === "run_tests") {
        if (values.filter) payload.filter = values.filter;
        if (values.ignore) payload.ignore = values.ignore;
        if (values.compileOnly !== undefined) payload.compileOnly = values.compileOnly;
      }
      if (values.action === "check_project") {
        if (values.severity) payload.severity = values.severity;
        if (values.pattern) payload.pattern = values.pattern;
        if (values.tool) payload.tool = values.tool;
        if (values.skipPackages !== undefined) payload.skipPackages = values.skipPackages;
      }

      const res = await dashboardActionFetch(`${apiBase}${endpoint}`, {
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

  const hasEnv = ['build_project', 'upload_firmware', 'upload_filesystem', 'run_tests', 'check_project', 'clean'].includes(action);
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

        {action === 'build_project' && (
          <Form.Item name="jobs" label="Parallel build jobs" rules={[{ type: 'integer', min: 1, max: 1024 }]} extra="Leave empty to use PlatformIO's default.">
            <InputNumber min={1} max={1024} step={1} placeholder="Default" style={{ width: '100%' }} />
          </Form.Item>
        )}

        {action === 'clean' && (
          <Form.Item name="full" label="Also remove downloaded dependencies" valuePropName="checked" preserve={false} extra="The next build may need to download dependencies again.">
            <Switch />
          </Form.Item>
        )}

        {action === 'run_tests' && (
          <>
            <Form.Item name="filter" label="Include test suites" rules={[{ max: 4096, pattern: /^[^\x00-\x1f\x7f]*$/, message: 'Use a test pattern without control characters.' }]}>
              <Input placeholder="For example, test_math*" maxLength={4096} />
            </Form.Item>
            <Form.Item name="ignore" label="Exclude test suites" rules={[{ max: 4096, pattern: /^[^\x00-\x1f\x7f]*$/, message: 'Use a test pattern without control characters.' }]}>
              <Input placeholder="For example, test_slow*" maxLength={4096} />
            </Form.Item>
            <Form.Item name="compileOnly" label="Build tests only" valuePropName="checked" extra="Builds test firmware without uploading or running tests. Build-only policy always enforces this.">
              <Switch />
            </Form.Item>
          </>
        )}

        {action === 'check_project' && (
          <>
            <Form.Item name="severity" label="Minimum severity">
              <Select allowClear placeholder="Project default" options={[
                { value: 'low', label: 'Low and above' },
                { value: 'medium', label: 'Medium and above' },
                { value: 'high', label: 'High only' },
              ]} />
            </Form.Item>
            <Form.Item name="pattern" label="Source file pattern" rules={[{ max: 4096, pattern: /^[^\x00-\x1f\x7f]*$/, message: 'Use a file pattern without control characters.' }]}>
              <Input placeholder="For example, src/*.cpp" maxLength={4096} />
            </Form.Item>
            <Form.Item name="tool" label="Analysis tool" rules={[{ max: 4096, pattern: /^[^\x00-\x1f\x7f]*$/, message: 'Use a tool name without control characters.' }]} extra="Leave empty to use the tools configured for this project.">
              <Input placeholder="For example, cppcheck" maxLength={4096} />
            </Form.Item>
            <Form.Item name="skipPackages" label="Exclude dependency source files" valuePropName="checked">
              <Switch />
            </Form.Item>
          </>
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
