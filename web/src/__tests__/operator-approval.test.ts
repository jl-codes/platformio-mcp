import { afterEach, it, expect, vi } from "vitest";
import { operatorApprovalFetch } from "../lib/operator-approval";
afterEach(() => vi.unstubAllGlobals());
it("submits the approval once using the session without a capability prompt", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  const headers = new Headers({ Authorization: "Bearer ordinary" });
  await operatorApprovalFetch("/api/safety/approvals/id/approve", { method: "POST", headers });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const sent = fetchMock.mock.calls[0][1];
  expect(sent.credentials).toBe("same-origin");
  expect(sent.headers.get("X-Pio-Dashboard-Approval")).toBe("1");
  expect(sent.headers.has("X-Pio-Approval-Token")).toBe(false);
  expect(headers.has("X-Pio-Dashboard-Approval")).toBe(false);
});
