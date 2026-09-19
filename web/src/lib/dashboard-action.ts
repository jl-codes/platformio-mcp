/** Dashboard command approval and exact-request retry, shared by mutation controls. */
import { Modal } from "antd";

/** Approval details displayed before the operator grants a pending command. */
export interface DashboardApproval {
  reason: string;
  projectDir?: string;
  environment?: string;
  port?: string;
}

/** Requires an explicit operator response; dismissing the dialog never approves. */
function confirmApproval(details: DashboardApproval): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: "Approve this operation?",
      content: [
        details.reason,
        details.projectDir,
        details.environment,
        details.port,
      ]
        .filter(Boolean)
        .join(" — "),
      okText: "Approve and run",
      cancelText: "Cancel",
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/**
 * Submits a dashboard mutation; if policy requests approval, confirms once and
 * retries the frozen original payload with that grant. A second policy challenge
 * is returned to the caller, never automatically approved in a loop.
 */
export async function dashboardActionFetch(
  url: string,
  init: RequestInit,
  confirm = confirmApproval,
): Promise<Response> {
  const snapshot = { ...init, headers: new Headers(init.headers) };
  const response = await fetch(url, snapshot);
  if (response.status !== 409 || typeof snapshot.body !== "string")
    return response;
  const data = await response.clone().json();
  const decision = data.policyDecision;
  if (
    decision?.status !== "requires_approval" ||
    typeof decision.approvalId !== "string"
  )
    return response;
  const payload = JSON.parse(snapshot.body);
  if (
    !(await confirm({
      reason: decision.reason,
      projectDir: payload.projectDir,
      environment: payload.environment,
      port: payload.port,
    }))
  )
    return response;
  const approvalUrl = new URL(
    `/api/safety/approvals/${encodeURIComponent(decision.approvalId)}/approve`,
    new URL(url, window.location.href),
  );
  const approved = await fetch(approvalUrl.href, {
    method: "POST",
    headers: snapshot.headers,
    credentials: snapshot.credentials,
  });
  if (!approved.ok) return approved;
  return fetch(url, {
    ...snapshot,
    body: JSON.stringify({ ...payload, approvalId: decision.approvalId }),
  });
}
