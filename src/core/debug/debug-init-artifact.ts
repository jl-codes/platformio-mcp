/** Retain exact GDB initialization bytes and bind authorization to script, ELF and endpoint identities. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { PlatformIOError } from "../../utils/errors.js";
import { createPrivateAnalysisDirectory } from "../analysis/private-analysis-directory.js";
import { bindDebugInitializationTemplate } from "./debug-init-template.js";
import type { OwnedDebugProcess } from "./debug-client-sessions.js";

/** Declared startup scope; a privileged script is executable code, not a proof of its eventual target effects. */
export interface DebugInitBinding {
  elfSha256: string;
  host: string;
  port: number;
  load: boolean;
}
/** Only the retaining module can mint this process-local script capability. */
export interface DebugInitArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly binding: Readonly<DebugInitBinding>;
  readonly authorization: Readonly<{
    kind: "script" | "template";
    sha256: string;
    size: number;
  }>;
  verify(): Promise<void>;
  release(): Promise<void>;
}
const activeArtifacts = new WeakSet<DebugInitArtifact>();

/** Snapshot a bounded generated script after authorization; keep it until every debugger consumer stops. */
export async function retainDebugInitialization(
  script: string,
  binding: DebugInitBinding,
): Promise<DebugInitArtifact> {
  return retainInitialization(script, binding);
}

/** Describe a validated template before allocating artifacts or acquiring probe custody. */
export function describeDebugInitializationTemplate(
  template: string,
  binding: DebugInitBinding,
  elfPath: string,
): Pick<DebugInitArtifact, "authorization" | "binding"> {
  bindDebugInitializationTemplate(template, {
    elfPath,
    host: binding.host,
    port: binding.port,
  });
  if (
    !/^[a-f0-9]{64}$/i.test(binding.elfSha256) ||
    typeof binding.load !== "boolean"
  )
    throw new PlatformIOError(
      "Invalid debugger initialization binding.",
      "DEBUG_INIT_ARTIFACT_INVALID",
    );
  return Object.freeze({
    binding: Object.freeze({
      ...binding,
      elfSha256: binding.elfSha256.toLowerCase(),
    }),
    authorization: Object.freeze({
      kind: "template" as const,
      sha256: createHash("sha256").update(template, "utf8").digest("hex"),
      size: Buffer.byteLength(template),
    }),
  });
}

/** Bind trusted Core placeholders; approvals identify the template and firmware, not random private paths. */
export async function retainDebugInitializationTemplate(
  template: string,
  binding: DebugInitBinding,
  retainedElfPath: string,
): Promise<DebugInitArtifact> {
  const script = bindDebugInitializationTemplate(template, {
    elfPath: retainedElfPath,
    host: binding.host,
    port: binding.port,
  });
  return retainInitialization(script, binding, template);
}

/** Keep exact byte integrity separate from the stable semantic approval identity. */
async function retainInitialization(
  script: string,
  binding: DebugInitBinding,
  template?: string,
): Promise<DebugInitArtifact> {
  if (
    typeof script !== "string" ||
    !script.trim() ||
    Buffer.byteLength(script) > 65536 ||
    script.includes("\0") ||
    !/^[a-f0-9]{64}$/i.test(binding.elfSha256) ||
    !isIP(binding.host) ||
    !Number.isInteger(binding.port) ||
    binding.port < 1 ||
    binding.port > 65535 ||
    typeof binding.load !== "boolean"
  )
    throw new PlatformIOError(
      "Invalid debugger initialization artifact.",
      "DEBUG_INIT_ARTIFACT_INVALID",
    );
  const directory = await fs.realpath(await createPrivateAnalysisDirectory());
  try {
    const file = path.join(directory, "initialization.gdb");
    if (/[\x00-\x1f\x7f]/.test(file))
      throw new PlatformIOError(
        "Invalid private debugger artifact path.",
        "DEBUG_INIT_ARTIFACT_INVALID",
      );
    const bytes = Buffer.from(script, "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await fs.writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    let release: Promise<void> | undefined;
    const artifact: DebugInitArtifact = Object.freeze({
      path: file,
      sha256,
      size: bytes.length,
      authorization: Object.freeze({
        kind: template === undefined ? "script" : "template",
        sha256: createHash("sha256")
          .update(template ?? script, "utf8")
          .digest("hex"),
        size: Buffer.byteLength(template ?? script),
      }),
      binding: Object.freeze({
        ...binding,
        elfSha256: binding.elfSha256.toLowerCase(),
      }),
      async verify() {
        assertDebugInitArtifact(artifact);
        const handle = await fs.open(file, "r");
        try {
          const stat = await handle.stat();
          const buffer = Buffer.alloc(65537);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          if (
            !stat.isFile() ||
            stat.size !== bytes.length ||
            bytesRead !== bytes.length ||
            createHash("sha256")
              .update(buffer.subarray(0, bytesRead))
              .digest("hex") !== sha256
          )
            throw new PlatformIOError(
              "Retained debugger initialization changed.",
              "DEBUG_INIT_ARTIFACT_CHANGED",
            );
        } finally {
          await handle.close();
        }
      },
      release() {
        if (!release)
          release = fs
            .rm(directory, { recursive: true, force: true })
            .then(() => {
              activeArtifacts.delete(artifact);
            })
            .catch((error: unknown) => {
              release = undefined;
              throw error;
            });
        return release;
      },
    });
    activeArtifacts.add(artifact);
    return artifact;
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Reject forged, serialized or released artifacts before any privileged execution. */
export function assertDebugInitArtifact(artifact: DebugInitArtifact): void {
  if (!activeArtifacts.has(artifact))
    throw new PlatformIOError(
      "Debugger initialization artifact is not active.",
      "DEBUG_INIT_ARTIFACT_INVALID",
    );
}

/** Preserve script bytes while process or probe cleanup remains uncertain. */
export function ownDebugInitialization(
  process: OwnedDebugProcess,
  artifact: DebugInitArtifact,
): OwnedDebugProcess {
  assertDebugInitArtifact(artifact);
  return {
    command: process.command.bind(process),
    state: () => ({ ...process.state(), init_script: artifact.path }),
    async cleanupProcess() {
      await process.cleanupProcess();
      await artifact.release();
    },
  };
}
