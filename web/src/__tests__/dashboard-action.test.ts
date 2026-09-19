/** Approval retries must be explicit and preserve the exact requested operation. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { dashboardActionFetch } from "../lib/dashboard-action";
vi.mock("../lib/operator-approval", () => ({operatorApprovalFetch: (url: string, init: RequestInit) => fetch(url, init)}));
afterEach(() => vi.unstubAllGlobals());
const pending = () =>
  new Response(
    JSON.stringify({
      policyDecision: {
        status: "requires_approval",
        approvalId: "approval-test",
        reason: "Firmware upload",
      },
    }),
    { status: 409 },
  );
const url = "http://localhost:8080/api/commands/upload_firmware";
const init = {
  method: "POST",
  body: JSON.stringify({
    projectDir: "/fixture",
    port: "COM7",
    environment: "test",
  }),
  headers: { Authorization: "Bearer fixture" },
};

describe("dashboard approval retry", () => {
  it("confirms then retries the original payload exactly once with its approval", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(new Response('{"success":true}'));
    vi.stubGlobal("fetch", fetch);
    const confirm = vi.fn(async () => true);
    expect((await dashboardActionFetch(url, init, confirm)).ok).toBe(true);
    expect(confirm).toHaveBeenCalledWith({
      reason: "Firmware upload",
      projectDir: "/fixture",
      port: "COM7",
      environment: "test",
    });
    expect(fetch.mock.calls[1][0]).toContain(
      "/api/safety/approvals/approval-test/approve",
    );
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
      ...JSON.parse(init.body),
      approvalId: "approval-test",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("never approves or retries after cancellation", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(pending());
    vi.stubGlobal("fetch", fetch);
    expect(
      (await dashboardActionFetch(url, init, async () => false)).status,
    ).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("returns a new policy challenge without automatically granting it", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(pending());
    vi.stubGlobal("fetch", fetch);
    const confirm = vi.fn(async () => true);
    expect((await dashboardActionFetch(url, init, confirm)).status).toBe(409);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
