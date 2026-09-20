/** Verify real policy scopes around an inert PPK2 process double; no device or interpreter is opened. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ collect: vi.fn(), cleanup: vi.fn() }));
vi.mock("../src/core/power/ppk2-process.js", () => ({
  Ppk2Process: class {
    collect = transport.collect;
    cleanupProcess = transport.cleanup;
    state() {
      return { cleanupPending: false };
    }
  },
}));
import {
  AuthorizedPpk2Operation,
  type AuthorizedPpk2Options,
} from "../src/core/power/authorized-ppk2.js";
import { approveRequest, getApproval } from "../src/core/policy/approvals.js";
let root: string;
beforeEach(() => {
  root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "pio-power-policy-")),
  );
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "policy.json"));
  vi.stubEnv("PIO_MCP_DATA_DIR", path.join(root, "data"));
  vi.resetAllMocks();
  transport.collect.mockResolvedValue({ finished: true });
  transport.cleanup.mockResolvedValue(undefined);
  policy();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function policy(deny: string[] = [], approvals: string[] = []) {
  fs.writeFileSync(
    path.join(root, "policy.json"),
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["power_source", "start_monitor", "run_shell_command"].filter(
          (name) => !deny.includes(name),
        ),
        deny,
        approval_required: approvals,
        audit_all_agent_actions: false,
      },
    }),
  );
}
function options(): AuthorizedPpk2Options {
  return {
    projectDir: root,
    pythonExecutable: path.join(root, "python.exe"),
    request: {
      port: "FAKE",
      mode: "source",
      voltageMv: 3300,
      currentLimitMa: 50,
      seconds: 1,
    },
    meter: {
      resources: [{ kind: "serial", identity: "meter" }],
      revalidate: vi.fn(),
    },
    dut: {
      resources: [{ kind: "serial", identity: "dut" }],
      revalidate: vi.fn(),
    },
  };
}
async function challenge(input: AuthorizedPpk2Options) {
  const operation = new AuthorizedPpk2Operation(input);
  const error = await operation.collect().then(
    () => null,
    (error) => error,
  );
  expect(error?.code).toBe("APPROVAL_REQUIRED");
  const id = error.context.policyDecision.approvalId as string;
  approveRequest(id);
  await operation.cleanupProcess();
  return id;
}
it.each(["power_source", "run_shell_command"])(
  "denies %s before collection",
  async (denied) => {
    policy([denied]);
    await expect(
      new AuthorizedPpk2Operation(options()).collect(),
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(transport.collect).not.toHaveBeenCalled();
  },
);
it("ampere mode uses measurement permission and cannot borrow source authority", async () => {
  policy(["power_source"]);
  const input = options();
  input.request = { ...(input.request as object), mode: "ampere" };
  await new AuthorizedPpk2Operation(input).collect();
  expect(transport.collect).toHaveBeenCalledOnce();
  expect(transport.cleanup).toHaveBeenCalledOnce();
});
it("preflights both grants before consuming either and rejects replay", async () => {
  policy([], ["run_shell_command", "power_source"]);
  const input = options();
  input.hostApprovalId = await challenge(input);
  input.powerApprovalId = await challenge(input);
  expect(getApproval(input.hostApprovalId)?.status).toBe("approved");
  expect(transport.collect).not.toHaveBeenCalled();
  await new AuthorizedPpk2Operation(input).collect();
  expect(getApproval(input.hostApprovalId)?.status).toBe("consumed");
  expect(getApproval(input.powerApprovalId)?.status).toBe("consumed");
  await expect(
    new AuthorizedPpk2Operation(input).collect(),
  ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  expect(transport.collect).toHaveBeenCalledOnce();
});
it.each([
  ["voltageMv", 3400],
  ["currentLimitMa", 60],
  ["seconds", 2],
  ["mode", "ampere"],
  ["port", "OTHER"],
])("binds approvals to %s", async (key, value) => {
  policy([], ["run_shell_command", "power_source"]);
  const input = options();
  input.hostApprovalId = await challenge(input);
  input.request = { ...(input.request as object), [key]: value };
  await expect(
    new AuthorizedPpk2Operation(input).collect(),
  ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  expect(getApproval(input.hostApprovalId)?.status).toBe("approved");
  expect(transport.collect).not.toHaveBeenCalled();
});
it.each(["meter", "dut"] as const)(
  "binds approvals to physical %s identity",
  async (key) => {
    policy([], ["run_shell_command", "power_source"]);
    const input = options();
    input.hostApprovalId = await challenge(input);
    input[key].resources = [{ kind: "serial", identity: "replacement" }];
    await expect(
      new AuthorizedPpk2Operation(input).collect(),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(transport.collect).not.toHaveBeenCalled();
  },
);
it("cancels active collection after policy changes and always cleans up", async () => {
  transport.collect.mockImplementation(
    (signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        });
        policy(["power_source"]);
      }),
  );
  await expect(
    new AuthorizedPpk2Operation(options()).collect(),
  ).rejects.toThrow("cancelled");
  expect(transport.cleanup).toHaveBeenCalledOnce();
});
it("keeps failed cleanup available for retry", async () => {
  transport.cleanup.mockRejectedValueOnce(new Error("cleanup pending"));
  const operation = new AuthorizedPpk2Operation(options());
  await expect(operation.collect()).rejects.toThrow("cleanup pending");
  await operation.cleanupProcess();
  expect(transport.cleanup).toHaveBeenCalledTimes(2);
});
it("does not consume grants or start collection after prior cancellation", async () => {
  policy([], ["run_shell_command", "power_source"]);
  const input = options();
  input.hostApprovalId = await challenge(input);
  input.powerApprovalId = await challenge(input);
  await expect(
    new AuthorizedPpk2Operation(input).collect(AbortSignal.abort()),
  ).rejects.toMatchObject({ code: "PPK2_CANCELLED" });
  expect(getApproval(input.hostApprovalId)?.status).toBe("approved");
  expect(getApproval(input.powerApprovalId)?.status).toBe("approved");
  expect(transport.collect).not.toHaveBeenCalled();
});
it("rejects collection after disconnect cleanup without consuming an approval", async () => {
  policy([], ["run_shell_command", "power_source"]);
  const input = options();
  input.hostApprovalId = await challenge(input);
  const operation = new AuthorizedPpk2Operation(input);
  await operation.cleanupProcess();
  await expect(operation.collect()).rejects.toMatchObject({
    code: "PPK2_OWNER_CLOSED",
  });
  expect(getApproval(input.hostApprovalId)?.status).toBe("approved");
  expect(transport.collect).not.toHaveBeenCalled();
});

it("cancels supervised collection when the owned trigger monitor closes", async () => {
  const selected = options(),
    monitor = new AbortController();
  selected.dutHold = {
    projectDir: root,
    resources: selected.dut.resources,
    signal: monitor.signal,
    prepareSpawn: vi.fn(),
    releaseAfterExit: vi.fn(),
  };
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  transport.collect.mockImplementation(
    (signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("monitor closed")),
          { once: true },
        );
        ready();
      }),
  );
  const operation = new AuthorizedPpk2Operation(selected);
  const running = operation.collect().catch((error) => error);
  await started;
  monitor.abort();
  expect((await running).message).toBe("monitor closed");
  expect(transport.cleanup).toHaveBeenCalledOnce();
});
it("checks the retained outer policy guard before any meter execution", async () => {
  const selected = options();
  selected.guard = () => {
    throw new Error("outer request revoked");
  };
  await expect(new AuthorizedPpk2Operation(selected).collect()).rejects.toThrow(
    "outer request revoked",
  );
  expect(transport.collect).not.toHaveBeenCalled();
});
