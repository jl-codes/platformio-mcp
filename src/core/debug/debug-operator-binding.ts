/** Resolve standalone remote-debugger custody from an operator-owned target map. */
import fs from "node:fs";
import { lookup } from "node:dns/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { z } from "zod";
import { PlatformIOError } from "../../utils/errors.js";
import { resolvePolicyDirectory } from "../policy/policy-sources.js";
import { DeviceLeaseStore } from "../devices/device-lease.js";
import {
  parseRemoteDebugEndpoint,
  parseRemoteDebugSelection,
} from "./debug-remote-endpoint.js";
import type { RemoteDebugTargetBinding } from "./debug-remote-startup.js";

const text = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[^\x00-\x1f\x7f]+$/);
const bindingSchema = z
  .object({
    version: z.literal(1),
    bindings: z
      .array(
        z
          .object({
            projectDir: text,
            environment: z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,49}$/),
            endpoint: text,
            targetId: text.max(800),
          })
          .strict(),
      )
      .max(128),
  })
  .strict();

/** The project selects an endpoint; only the operator map assigns its stable target identity. */
export interface RemoteDebugSelection {
  projectDir: string;
  environment: string;
  endpoint: string | null;
}

/** Read bounded JSON and reject aliases/duplicate keys and project-controlled storage. */
function readBindings(filename: string, project: string) {
  const real = fs.realpathSync.native(filename);
  const relative = path.relative(project, real);
  if (
    !relative ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    throw new PlatformIOError(
      "Remote target bindings must be outside the project.",
      "DEBUG_REMOTE_BINDING_INVALID",
    );
  const descriptor = fs.openSync(real, "r");
  let content: string;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 65536)
      throw new Error("Invalid target map size");
    const bytes = Buffer.alloc(65537);
    const size = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
    if (size > 65536) throw new Error("Target map grew beyond limit");
    content = bytes.subarray(0, size).toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
  JSON.parse(content);
  const document = parseDocument(content, {
    version: "1.2",
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length || document.warnings.length)
    throw new Error("Invalid target map");
  const data = bindingSchema.parse(document.toJS({ maxAliasCount: 0 }));
  return {
    real,
    digest: createHash("sha256").update(content).digest("hex"),
    data,
  };
}

/** Supply retained per-account leases to the same supervised remote path used by embedding hosts. */
export async function resolveOperatorRemoteDebugBinding(
  selection: Readonly<RemoteDebugSelection>,
  host: {
    filename?: string;
    store?: DeviceLeaseStore;
    lookup?: (hostname: string) => Promise<{ address: string }>;
  } = {},
): Promise<RemoteDebugTargetBinding> {
  const filename =
    host.filename ?? path.join(resolvePolicyDirectory(), "debug-targets.json");
  let project: string;
  let snapshot: ReturnType<typeof readBindings>;
  try {
    project = fs.realpathSync.native(selection.projectDir);
    snapshot = readBindings(filename, project);
  } catch (error) {
    if (error instanceof PlatformIOError) throw error;
    throw new PlatformIOError(
      "Configure a valid operator debug-targets.json outside the project before remote debugging.",
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "DEBUG_REMOTE_BINDING_REQUIRED"
        : "DEBUG_REMOTE_BINDING_INVALID",
    );
  }
  const endpoint = parseRemoteDebugSelection(selection.endpoint);
  const matches = snapshot.data.bindings.filter((binding) => {
    if (!path.isAbsolute(binding.projectDir))
      throw new PlatformIOError(
        "Target maps require absolute project paths.",
        "DEBUG_REMOTE_BINDING_INVALID",
      );
    return (
      path.normalize(binding.projectDir) === project &&
      binding.environment === selection.environment &&
      parseRemoteDebugSelection(binding.endpoint).resource.identity ===
        endpoint.resource.identity
    );
  });
  if (matches.length !== 1)
    throw new PlatformIOError(
      "Select exactly one operator binding for this project, environment and endpoint.",
      "DEBUG_REMOTE_BINDING_REQUIRED",
    );
  const selected = matches[0];
  let pinned = endpoint;
  if (endpoint.resource.identity.startsWith("debug-dns:")) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const resolved = await Promise.race([
        (host.lookup ?? lookup)(endpoint.host),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("DNS timeout")), 3000);
        }),
      ]);
      pinned = parseRemoteDebugEndpoint(
        `${resolved.address.includes(":") ? "[" + resolved.address + "]" : resolved.address}:${endpoint.port}`,
      );
    } catch {
      throw new PlatformIOError(
        "Could not resolve the bound debugger hostname to a unicast address within three seconds.",
        "DEBUG_REMOTE_RESOLUTION_FAILED",
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const resource = Object.freeze({
    kind: "network" as const,
    identity: "debug-target:" + selected.targetId,
  });
  const store = host.store ?? new DeviceLeaseStore();
  const revalidate = () => {
    try {
      const current = readBindings(filename, project);
      if (current.real !== snapshot.real || current.digest !== snapshot.digest)
        throw new Error("Target map changed");
    } catch {
      throw new PlatformIOError(
        "Operator target binding changed; restart debugger preparation.",
        "DEBUG_REMOTE_BINDING_CHANGED",
      );
    }
  };
  return Object.freeze({
    endpoint: `${pinned.host.includes(":") ? "[" + pinned.host + "]" : pinned.host}:${pinned.port}`,
    sourceEndpoint: selected.endpoint,
    identity: JSON.stringify([resource.identity, snapshot.digest]),
    revalidate,
    acquireTarget: async () => {
      revalidate();
      const lease = store.acquire(resource);
      return {
        prepareSpawn() {
          revalidate();
          store.beginHandoff(lease);
        },
        releaseAfterExit() {
          store.cancelHandoff(lease);
          store.release(lease);
        },
      };
    },
  });
}
