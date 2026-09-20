/** Execute the installed espota uploader with private stdin credentials and confirmed process custody. */
import { spawn } from "node:child_process";
import path from "node:path";
import { isIP } from "node:net";
import { waitForOwnedProcess } from "../../utils/owned-process-wait.js";
import { PlatformIOError } from "../../utils/errors.js";
import type { ProcessDeviceCustody } from "../devices/process-device-custody.js";

// Constant program; request data is JSON on stdin and never interpolated into executable code or argv.
const ESPOTA_BRIDGE = String.raw`
import hashlib, json, runpy, sys
request = json.loads(sys.stdin.buffer.read(65537))
for filename, expected in [(request["image"], request["imageSha256"]), (request["script"], request["scriptSha256"])]:
    digest = hashlib.sha256()
    with open(filename, "rb") as artifact:
        while True:
            chunk = artifact.read(65536)
            if not chunk:
                break
            digest.update(chunk)
    if digest.hexdigest() != expected:
        raise RuntimeError("OTA artifact changed before execution")
sys.argv = [request["script"], "--ip", request["address"], "--port", str(request["port"]), "--file", request["image"], "--progress"]
if request["auth"] is not None:
    sys.argv += ["--auth", request["auth"]]
if request["filesystem"]:
    sys.argv += ["--spiffs"]
runpy.run_path(request["script"], run_name="__main__")
`;

/** Trusted resolved native interpreter, framework uploader and immutable image; public JSON cannot grant trust. */
export interface EspotaProcessRequest {
  pythonExecutable: string;
  uploaderScript: string;
  imagePath: string;
  imageSha256: string;
  uploaderSha256: string;
  address: string;
  port: number;
  auth?: string;
  filesystem: boolean;
  timeoutMs: number;
  custody: ProcessDeviceCustody;
  signal?: AbortSignal;
}

/** Retain custody until process and pipes are closed; no command strings or credentials are logged. */
export async function runEspotaProcess(request: EspotaProcessRequest) {
  if (
    [request.pythonExecutable, request.uploaderScript, request.imagePath].some(
      (value) =>
        typeof value !== "string" ||
        !path.isAbsolute(value) ||
        value.length > 32768 ||
        /[\x00-\x1f\x7f]/.test(value),
    ) ||
    /\.(?:cmd|bat|ps1|sh)$/i.test(request.pythonExecutable) ||
    isIP(request.address) !== 4 ||
    !Number.isInteger(request.port) ||
    request.port < 1 ||
    request.port > 65535 ||
    !Number.isInteger(request.timeoutMs) ||
    request.timeoutMs < 1 ||
    request.timeoutMs > 600000 ||
    typeof request.filesystem !== "boolean" ||
    !/^[a-f0-9]{64}$/.test(request.imageSha256) ||
    !/^[a-f0-9]{64}$/.test(request.uploaderSha256) ||
    (request.auth !== undefined &&
      (typeof request.auth !== "string" ||
        request.auth.length > 1024 ||
        /[\x00-\x1f\x7f]/.test(request.auth)))
  )
    throw new PlatformIOError(
      "Invalid resolved OTA execution request.",
      "OTA_EXECUTION_INVALID",
    );
  const payload = JSON.stringify({
    script: request.uploaderScript,
    image: request.imagePath,
    imageSha256: request.imageSha256,
    scriptSha256: request.uploaderSha256,
    address: request.address,
    port: request.port,
    auth: request.auth ?? null,
    filesystem: request.filesystem,
  });
  if (Buffer.byteLength(payload) > 65536)
    throw new PlatformIOError(
      "OTA request exceeds the private input limit.",
      "OTA_EXECUTION_INVALID",
    );
  if (request.signal?.aborted)
    throw new PlatformIOError(
      "OTA upload was cancelled before startup.",
      "OTA_CANCELLED",
    );
  await request.custody.prepareSpawn();
  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(request.pythonExecutable, ["-I", "-c", ESPOTA_BRIDGE], {
      cwd: path.dirname(request.imagePath),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
    });
  } catch {
    request.custody.releaseAfterExit();
    throw new PlatformIOError(
      "OTA uploader could not start.",
      "OTA_PROCESS_FAILED",
    );
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal?.addEventListener("abort", abort, { once: true });
  if (request.signal?.aborted) abort();
  let outputBytes = 0,
    limited = false,
    closed = false,
    inputFailed = false;
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  let resolveClosed!: () => void;
  const closure = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  proc.once("close", () => {
    closed = true;
    resolveClosed();
  });
  const collect = (destination: Buffer[]) => (chunk: Buffer) => {
    if (limited) return;
    outputBytes += chunk.length;
    if (outputBytes > 1024 * 1024) {
      limited = true;
      controller.abort();
      return;
    }
    destination.push(Buffer.from(chunk));
  };
  proc.stdout!.on("data", collect(stdout));
  proc.stderr!.on("data", collect(stderr));
  proc.stdin!.on("error", () => {
    inputFailed = true;
    controller.abort();
  });
  const completion = waitForOwnedProcess(
    proc,
    request.timeoutMs,
    1000,
    controller.signal,
  );
  proc.stdin!.end(payload);
  let exitCode: number | undefined, failure: unknown;
  try {
    exitCode = await completion;
  } catch (error) {
    failure = error;
  }
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  if (!closed)
    await Promise.race([
      closure,
      new Promise<void>((resolve) => {
        closeTimer = setTimeout(resolve, 1000);
      }),
    ]);
  clearTimeout(closeTimer);
  request.signal?.removeEventListener("abort", abort);
  if (!closed)
    throw new PlatformIOError(
      "OTA process cleanup is unconfirmed.",
      "OTA_CLEANUP_PENDING",
      { cleanupPending: true },
    );
  request.custody.releaseAfterExit();
  if (limited)
    throw new PlatformIOError(
      "OTA uploader exceeded the output limit.",
      "OTA_OUTPUT_LIMIT",
      { cleanupPending: false },
    );
  if (inputFailed)
    throw new PlatformIOError(
      "OTA uploader rejected private input.",
      "OTA_PROCESS_FAILED",
      { cleanupPending: false },
    );
  if (failure)
    throw new PlatformIOError(
      "OTA uploader did not complete.",
      request.signal?.aborted
        ? "OTA_CANCELLED"
        : failure instanceof PlatformIOError &&
            failure.code === "COMMAND_TIMEOUT"
          ? "OTA_TIMEOUT"
          : "OTA_PROCESS_FAILED",
      { cleanupPending: false },
    );
  const redact = (buffers: Buffer[]) => {
    let text = Buffer.concat(buffers).toString("utf8");
    if (request.auth)
      for (const secret of new Set([
        request.auth,
        JSON.stringify(request.auth).slice(1, -1),
        encodeURIComponent(request.auth),
      ]))
        text = text.split(secret).join("[REDACTED]");
    return text;
  };
  return {
    exitCode: exitCode!,
    stdout: redact(stdout),
    stderr: redact(stderr),
  };
}
