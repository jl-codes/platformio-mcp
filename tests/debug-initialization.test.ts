/** Exercise startup ordering and failure against the actual token-correlated transport. */
import path from "node:path";
import { expect, it } from "vitest";
import { GdbMiSession } from "../src/core/debug/gdb-mi-session.js";
import {
  GDB_STARTUP_ARGS,
  initializeGdbInspection,
} from "../src/core/debug/debug-initialization.js";

const elf = path.resolve("fixture with spaces/firmware.elf");

it("suppresses implicit initialization before entering the MI loop", () => {
  expect(GDB_STARTUP_ARGS).toEqual([
    "-nx",
    "--quiet",
    "--interpreter=mi2",
    "-iex",
    "set auto-load off",
    "-iex",
    "set may-call-functions off",
  ]);
  expect(Object.isFrozen(GDB_STARTUP_ARGS)).toBe(true);
});

it("waits for every safeguard acknowledgement before loading symbols", async () => {
  const lines: string[] = [];
  const session = new GdbMiSession(async (line) => {
    lines.push(line);
    const token = /^(\d+)/.exec(line)![1];
    queueMicrotask(() => session.accept(Buffer.from(token + "^done\n")));
  });
  await initializeGdbInspection(session, elf);
  expect(lines.map((line) => line.replace(/^\d+/, "").trim())).toEqual([
    "-gdb-set auto-load off",
    "-gdb-set may-call-functions off",
    "-gdb-set pagination off",
    "-gdb-set confirm off",
    "-file-exec-and-symbols " + JSON.stringify(elf),
  ]);
  await expect(initializeGdbInspection(session, elf)).rejects.toMatchObject({
    code: "GDB_INIT_REUSED",
  });
});

it.each([1, 2, 3, 4])(
  "never loads symbols if safeguard %s fails",
  async (failedStep) => {
    const lines: string[] = [];
    const session = new GdbMiSession(async (line) => {
      lines.push(line);
      const token = /^(\d+)/.exec(line)![1];
      queueMicrotask(() =>
        session.accept(
          Buffer.from(
            token +
              (lines.length === failedStep
                ? '^error,msg="unsupported setting"\n'
                : "^done\n"),
          ),
        ),
      );
    });
    await expect(initializeGdbInspection(session, elf)).rejects.toMatchObject({
      code: "GDB_INIT_FAILED",
      context: { cleanupPending: true },
    });
    expect(lines).toHaveLength(failedStep);
    await expect(session.execute("-stack-list-frames")).rejects.toMatchObject({
      code: "GDB_TRANSPORT_FAILED",
    });
    expect(lines.some((line) => line.includes("-file-exec-and-symbols"))).toBe(
      false,
    );
  },
);

it("a deadline leaves cleanup pending and never loads symbols", async () => {
  const lines: string[] = [];
  const session = new GdbMiSession(async (line) => {
    lines.push(line);
  });
  await expect(initializeGdbInspection(session, elf, 20)).rejects.toMatchObject(
    {
      code: "GDB_INIT_FAILED",
      context: { cleanupPending: true },
    },
  );
  expect(lines).toHaveLength(1);
  expect(session.state().closed).toBe(false);
});

it("quotes the complete absolute ELF path as one MI argument", async () => {
  const tricky = path.resolve('symbols/quote"backslash\\name.elf');
  const lines: string[] = [];
  const session = new GdbMiSession(async (line) => {
    lines.push(line);
    queueMicrotask(() =>
      session.accept(Buffer.from(/^(\d+)/.exec(line)![1] + "^done\n")),
    );
  });
  await initializeGdbInspection(session, tricky);
  expect(lines.at(-1)?.trim()).toBe(
    "5-file-exec-and-symbols " + JSON.stringify(tricky),
  );
});
