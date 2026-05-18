import React from "react";
import { Button, Card, Empty, List, Space, Tag, Tooltip, Typography, message } from "antd";
import { SafetyCertificateOutlined, FileSearchOutlined, ClockCircleOutlined } from "@ant-design/icons";

const { Text } = Typography;

type ApprovalItem = {
  id: string;
  action: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  reason: string;
  requestedBy: "agent" | "user" | "system";
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
  expiresAt?: string;
};

type AuditItem = {
  id: string;
  action: string;
  status: "allowed" | "denied" | "requires_approval" | "approved" | "failed" | "completed";
  reason?: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  timestamp: string;
};

type DeviceLockItem = {
  lockFile: string;
  port: string;
  claimType?: string;
  ownerWorkspace?: string;
  ownerPid?: number;
  timestamp?: number;
};

type DiagnosticItem = {
  commandId?: string;
  taskId?: string;
  toolName?: string;
  status?: string;
  diagnostic: {
    success: boolean;
    stage: string;
    errorType?: string;
    severity: "info" | "warning" | "error" | "critical";
    summary: string;
    recommendedAction: string;
    safeToAutoRetry: boolean;
    rawLogPath?: string;
    timestamp: string;
  };
};

type RawLogLink = {
  commandId?: string;
  taskId?: string;
  type?: string;
  logPath: string;
  exists: boolean;
};

type SafetyOverviewPayload = {
  pendingApprovals: ApprovalItem[];
  recentAuditEvents: AuditItem[];
  deviceLocks: DeviceLockItem[];
  recentDiagnostics: DiagnosticItem[];
  rawLogLinks: RawLogLink[];
};

interface SafetyPolicyOverviewProps {
  payload: SafetyOverviewPayload | null;
  loading: boolean;
  apiBase: string;
  token: string;
  onActionComplete?: () => void;
}

function riskColor(risk: string) {
  if (risk === "critical") return "red";
  if (risk === "high") return "volcano";
  if (risk === "medium") return "gold";
  return "blue";
}

function severityColor(severity: string) {
  if (severity === "critical") return "red";
  if (severity === "error") return "volcano";
  if (severity === "warning") return "gold";
  return "green";
}

export default function SafetyPolicyOverview({
  payload,
  loading,
  apiBase,
  token,
  onActionComplete,
}: SafetyPolicyOverviewProps) {
  const updateApproval = async (id: string, action: "approve" | "deny") => {
    const res = await fetch(`${apiBase}/api/safety/approvals/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to ${action} approval ${id}`);
    }
    message.success(`Approval ${action}d: ${id}`);
    onActionComplete?.();
  };

  return (
    <Card
      title={
        <Space>
          <SafetyCertificateOutlined />
          <Text strong>SAFETY & DIAGNOSTICS</Text>
        </Space>
      }
      loading={loading}
    >
      {!payload ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No safety overview data available." />
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size={18}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>PENDING APPROVALS</Text>
            <List
              size="small"
              dataSource={payload.pendingApprovals.slice(0, 5)}
              locale={{ emptyText: "No pending approvals." }}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button
                      key="approve"
                      size="small"
                      type="primary"
                      onClick={() =>
                        void updateApproval(item.id, "approve").catch((error: any) =>
                          message.error(error?.message || "Failed to approve request"),
                        )
                      }
                    >
                      Approve
                    </Button>,
                    <Button
                      key="deny"
                      size="small"
                      danger
                      onClick={() =>
                        void updateApproval(item.id, "deny").catch((error: any) =>
                          message.error(error?.message || "Failed to deny request"),
                        )
                      }
                    >
                      Deny
                    </Button>,
                  ]}
                >
                  <Space direction="vertical" size={2} style={{ width: "100%" }}>
                    <Space>
                      <Tag color={riskColor(item.riskLevel)}>{item.riskLevel.toUpperCase()}</Tag>
                      <Text code>{item.action}</Text>
                      <Text type="secondary">{new Date(item.createdAt).toLocaleString()}</Text>
                    </Space>
                    <Text style={{ fontSize: 12 }}>{item.reason}</Text>
                  </Space>
                </List.Item>
              )}
            />
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>DEVICE LOCK STATUS</Text>
            <List
              size="small"
              dataSource={payload.deviceLocks}
              locale={{ emptyText: "No active device locks." }}
              renderItem={(item) => (
                <List.Item>
                  <Space direction="vertical" size={2} style={{ width: "100%" }}>
                    <Space>
                      <Tag color={item.claimType === "upload" ? "gold" : "green"}>
                        {(item.claimType || "locked").toUpperCase()}
                      </Tag>
                      <Text code>{item.port}</Text>
                      {item.ownerPid ? <Text type="secondary">pid {item.ownerPid}</Text> : null}
                    </Space>
                    {item.ownerWorkspace ? (
                      <Tooltip title={item.ownerWorkspace}>
                        <Text type="secondary" ellipsis>
                          {item.ownerWorkspace}
                        </Text>
                      </Tooltip>
                    ) : null}
                  </Space>
                </List.Item>
              )}
            />
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>RECENT DIAGNOSTICS</Text>
            <List
              size="small"
              dataSource={payload.recentDiagnostics.slice(0, 8)}
              locale={{ emptyText: "No diagnostics captured yet." }}
              renderItem={(item) => (
                <List.Item>
                  <Space direction="vertical" size={2} style={{ width: "100%" }}>
                    <Space>
                      <Tag color={severityColor(item.diagnostic.severity)}>
                        {item.diagnostic.severity.toUpperCase()}
                      </Tag>
                      <Text code>{item.diagnostic.stage}</Text>
                      {item.diagnostic.errorType ? <Text>{item.diagnostic.errorType}</Text> : null}
                    </Space>
                    <Text style={{ fontSize: 12 }}>{item.diagnostic.summary}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {item.diagnostic.recommendedAction}
                    </Text>
                  </Space>
                </List.Item>
              )}
            />
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>RECENT AUDIT EVENTS</Text>
            <List
              size="small"
              dataSource={payload.recentAuditEvents.slice(0, 8)}
              locale={{ emptyText: "No audit events available." }}
              renderItem={(item) => (
                <List.Item>
                  <Space>
                    <Tag color={riskColor(item.riskLevel)}>{item.status.toUpperCase()}</Tag>
                    <Text code>{item.action}</Text>
                    <Text type="secondary">
                      <ClockCircleOutlined /> {new Date(item.timestamp).toLocaleTimeString()}
                    </Text>
                  </Space>
                </List.Item>
              )}
            />
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>RAW LOG LINKS</Text>
            <List
              size="small"
              dataSource={payload.rawLogLinks.slice(0, 8)}
              locale={{ emptyText: "No raw logs indexed." }}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button
                      key="copy"
                      size="small"
                      icon={<FileSearchOutlined />}
                      onClick={() => navigator.clipboard.writeText(item.logPath)}
                    >
                      Copy Path
                    </Button>,
                  ]}
                >
                  <Space direction="vertical" size={1} style={{ width: "100%" }}>
                    <Space>
                      <Tag color={item.exists ? "blue" : "default"}>
                        {item.type?.toUpperCase() || "LOG"}
                      </Tag>
                      {item.taskId ? <Text code>{item.taskId}</Text> : null}
                    </Space>
                    <Tooltip title={item.logPath}>
                      <Text ellipsis type="secondary">{item.logPath}</Text>
                    </Tooltip>
                  </Space>
                </List.Item>
              )}
            />
          </div>
        </Space>
      )}
    </Card>
  );
}
