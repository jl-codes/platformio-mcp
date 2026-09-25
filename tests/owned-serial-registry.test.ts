/** Owned sessions share schemas and handlers without changing legacy monitor tools. */
import { expect, it, vi } from "vitest";
import {
  OWNED_SERIAL_TOOLS,
  withOwnedSerialTools,
  withDeviceCompatibility,
} from "../src/adapters/device-compat.js";
import type { RegisteredTool } from "../src/mcp/tool-registry.js";

it("exposes serial lifecycle and diagnostic operations through the shared authorized handlers", async () => {
  const base = new Map<string, RegisteredTool<unknown>>();
  for (const name of [
    "list_devices",
    "decode_backtrace",
    "size_report",
    "start_monitor",
    "query_logs",
    "upload_firmware",
    "get_monitor_status",
    "stop_monitor",
  ]) {
    base.set(name, {
      name,
      inputSchema: { type: "object" },
      handler: vi.fn(),
      annotations: {},
      policyAction: name,
    } as unknown as RegisteredTool<unknown>);
  }
  const canonical = withOwnedSerialTools(base);
  const both = withDeviceCompatibility(canonical);
  for (const [name, alias] of Object.entries(OWNED_SERIAL_TOOLS)) {
    expect(canonical.has(alias)).toBe(false);
    expect(canonical.get(name)?.inputSchema).toEqual(
      both.get(alias)?.inputSchema,
    );
    expect(canonical.get(name)?.policyAction).toBe(
      both.get(alias)?.policyAction,
    );
    const dispatch = vi.fn(async () => ({ ok: true }));
    const args = { session_id: "owned-session" };
    await canonical.get(name)!.handler(args, { dispatch });
    expect(dispatch).toHaveBeenCalledWith(alias, args);
  }
  for (const [name, original] of base)
    expect(canonical.get(name)).toBe(original);
  expect(() => withOwnedSerialTools(canonical)).toThrow(
    "Duplicate owned serial tool",
  );
});
