/** Real policy grants must remain scoped, one-use and isolated when a CLI invocation approves in place. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { withInteractiveApprovals } from "../src/core/policy/interactive-approvals.js";
import {
  planAction,
  dispatchAuthorizedAction,
} from "../src/core/action-dispatcher.js";
import { getApproval } from "../src/core/policy/approvals.js";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-interactive-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", root);
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "operator.json"));
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({ profile: "flash_requires_approval" }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
const caller = { actor: "user" as const };
it("carries a planned grant into execution once without replaying prior effects", async () => {
  const confirm = vi.fn(async () => true);
  const execute = vi.fn(async () => "done");
  const args = { projectDir: root, port: "COM7" };
  await withInteractiveApprovals(confirm, async () => {
    const plan = await planAction("upload_firmware", args, caller);
    expect(plan.status).toBe("ready");
    expect(getApproval(plan.approvalId!)?.status).toBe("approved");
    await dispatchAuthorizedAction("upload_firmware", args, caller, execute);
    expect(confirm).toHaveBeenCalledOnce();
    expect(getApproval(plan.approvalId!)?.status).toBe("consumed");
    await dispatchAuthorizedAction("upload_firmware", args, caller, execute);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
  expect(execute).toHaveBeenCalledTimes(2);
  await expect(
    dispatchAuthorizedAction("upload_firmware", args, caller, execute),
  ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
});
it("does not authorize changed destinations using the planned grant", async () => {
  const confirm = vi.fn(async () => true);
  await withInteractiveApprovals(confirm, async () => {
    await planAction(
      "upload_firmware",
      { projectDir: root, port: "COM7" },
      caller,
    );
    await dispatchAuthorizedAction(
      "upload_firmware",
      { projectDir: root, port: "COM8" },
      caller,
      async () => {},
    );
  });
  expect(confirm).toHaveBeenCalledTimes(2);
});
it("honors refusal and explicit policy denial with no effects", async () => {
  const execute = vi.fn();
  await expect(
    withInteractiveApprovals(
      async () => false,
      () =>
        dispatchAuthorizedAction(
          "upload_firmware",
          { projectDir: root },
          caller,
          execute,
        ),
    ),
  ).rejects.toMatchObject({ code: "APPROVAL_DENIED" });
  const confirm = vi.fn(async () => {
    fs.writeFileSync(
      path.join(root, "operator.json"),
      JSON.stringify({ profile: "read_only" }),
    );
    return true;
  });
  await expect(
    withInteractiveApprovals(confirm, () =>
      dispatchAuthorizedAction(
        "upload_firmware",
        { projectDir: root },
        caller,
        execute,
      ),
    ),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(execute).not.toHaveBeenCalled();
});
it("does not enable agent or scheduled requests", async () => {
  const confirm = vi.fn(async () => true);
  await withInteractiveApprovals(confirm, async () => {
    for (const context of [
      { actor: "agent" as const },
      { actor: "user" as const, actorClass: "scheduled" as const },
    ]) {
      await expect(
        dispatchAuthorizedAction(
          "upload_firmware",
          { projectDir: root },
          context,
          async () => {},
        ),
      ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    }
  });
  expect(confirm).not.toHaveBeenCalled();
});
