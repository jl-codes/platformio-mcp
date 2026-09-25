/** Adapt an owned interactive supervisor to GDB's byte streams without treating root exit as cleanup proof. */
import { EventEmitter } from "node:events";
import { PassThrough, Writable, type Readable } from "node:stream";
import { DebugBackendProcess } from "./debug-backend-process.js";
import type { DebugServerCommand } from "./debug-server-config.js";

/** Minimal child transport consumed by the GDB owner; supervision is an independent lifetime capability. */
export interface GdbProcessChild extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  readonly pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
}

/** All launched descendants stay under the supervisor's Job Object or pinned POSIX process group. */
export class SupervisedDebugChild
  extends EventEmitter
  implements GdbProcessChild
{
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  readonly supervisor: DebugBackendProcess;

  /** Inputs are already host-resolved and authorized by debugger startup. */
  constructor(pythonExecutable: string, command: DebugServerCommand) {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        void this.supervisor
          .writeStdin(Buffer.from(chunk))
          .then(() => callback(), callback);
      },
    });
    this.supervisor = new DebugBackendProcess({
      pythonExecutable,
      command,
      onStdout: (data) => {
        this.stdout.write(data);
      },
      onStderr: (data) => {
        this.stderr.write(data);
      },
      onClose: (exitCode) => {
        this.stdout.end();
        this.stderr.end();
        this.emit("close", exitCode);
      },
    });
  }

  /** Actual supervised process identity, distinct from the supervisor's own PID. */
  get pid(): number | undefined {
    return this.supervisor.state().pid;
  }

  /** Request whole-group cleanup; callers must still await the supervisor's confirmation. */
  kill(): boolean {
    void this.supervisor
      .cleanupProcess()
      .catch((error: unknown) => this.emit("error", error));
    return true;
  }
}
