/** Execute only retained esptool inputs under explicit device custody and descendant supervision. */
import { PlatformIOError } from "../../utils/errors.js";
import { DebugBackendProcess } from "../debug/debug-backend-process.js";
import type { ProcessDeviceCustody } from "../devices/process-device-custody.js";
import {
  validateEspUploadCommand,
  type EspUploadCommandContext,
} from "./esptool-upload-command.js";
import type { retainUploadCapture } from "./upload-capture-record.js";

/** Preserve the trusted cleanup capability if a supervised uploader cannot prove closure. */
export class UploadCleanupFailure extends PlatformIOError {
  #cleanup: () => Promise<void>;
  constructor(cleanup: () => Promise<void>) {
    super("Uploader cleanup remains pending.", "UPLOAD_CLEANUP_PENDING", {
      cleanupPending: true,
    });
    this.#cleanup = cleanup;
  }
  /** Retry process-tree cleanup and custody release; never expose this capability in public JSON. */
  cleanupProcess(): Promise<void> {
    return this.#cleanup();
  }
}

/** Internal controls supplied by the already-authorized upload workflow, not public JSON arguments. */
export interface RetainedUploadExecution {
  custody: ProcessDeviceCustody;
  guard: () => void;
  finishCustody?: () => void; // Host sequence completion remains part of retryable cleanup.
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Launch the retained command after manifest-bound upload authorization. Recheck identities and bytes,
 * hold device custody until the supervisor proves descendant closure, and preserve retryable cleanup.
 * A zero exit status proves command completion only; boot/runtime identity still needs serial evidence.
 */
export async function executeRetainedEspUpload(
  retained: Awaited<ReturnType<typeof retainUploadCapture>>,
  context: EspUploadCommandContext,
  execution: RetainedUploadExecution,
) {
  const selected = { ...context };
  const options = { ...execution };
  const argv = retained.arguments;
  const manifest = retained.manifest;
  const timeout = options.timeoutMs ?? 180000;
  let processOwner: DebugBackendProcess | undefined;
  let released = false;
  let output = Buffer.alloc(0);
  const cleanup = async () => {
    if (released) return;
    await processOwner?.cleanupProcess();
    options.custody.releaseAfterExit();
    options.finishCustody?.();
    released = true;
  };
  const check = () => {
    options.guard();
    if (options.signal?.aborted)
      throw new PlatformIOError(
        "Upload cancelled before execution.",
        "PROCESS_CANCELLED",
        { cleanupPending: false },
      );
  };
  const append = (data: Buffer) => {
    output = Buffer.concat([output, data]).subarray(-2 * 1024 * 1024);
  };
  let result:
    | {
        exitCode: number;
        output: string;
        manifestSha256: string;
        manifest: typeof manifest;
      }
    | undefined;
  let failure: unknown;
  try {
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600000)
      throw new PlatformIOError(
        "Invalid upload deadline.",
        "UPLOAD_CAPTURE_INVALID",
      );
    check();
    await validateEspUploadCommand(argv, selected);
    await retained.verify();
    check();
    await options.custody.prepareSpawn();
    await retained.verify();
    check();
    processOwner = new DebugBackendProcess({
      pythonExecutable: selected.pythonPath,
      command: {
        executable: argv[0],
        arguments: argv.slice(1),
        cwd: manifest.projectDir,
      },
      onStdout: append,
      onStderr: append,
    });
    const exitCode = await processOwner.waitForCompletion(
      timeout,
      options.signal,
    );
    result = {
      exitCode,
      output: output.toString("utf8"),
      manifestSha256: retained.sha256,
      manifest,
    };
  } catch (error) {
    failure = error;
  }
  try {
    await cleanup();
  } catch {
    throw new UploadCleanupFailure(cleanup);
  }
  if (failure instanceof PlatformIOError)
    throw new PlatformIOError(failure.message, failure.code, {
      ...failure.context,
      cleanupPending: false,
    });
  if (failure !== undefined) throw failure;
  return result!;
}
