import { afterEach, it, expect, vi } from "vitest";
import { operatorApprovalFetch } from "../lib/operator-approval";
afterEach(() => vi.unstubAllGlobals());
it("adds the operator capability only to the approval request without changing original headers", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  const headers = new Headers({ Authorization: "Bearer ordinary" });
  await operatorApprovalFetch(
    "http://localhost/api/safety/approvals/id/approve",
    { method: "POST", headers },
    async () => "separate-capability",
  );
  expect(headers.has("X-Pio-Approval-Token")).toBe(false);
  const sent = fetchMock.mock.calls[0][1];
  expect(sent.headers.get("X-Pio-Approval-Token")).toBe("separate-capability");
  expect(sent.headers.get("Authorization")).toBe("Bearer ordinary");
  expect(sent.body).toBeUndefined();
});
it("does not transmit an approval after capability entry is cancelled", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(
    (
      await operatorApprovalFetch(
        "http://localhost/approve",
        { method: "POST" },
        async () => null,
      )
    ).status,
  ).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});
