/** Bounded structured projection of esp-coredump analyzer output with common-secret redaction. */
import { PlatformIOError } from "../../utils/errors.js";
import { redactSecretsInText } from "../policy/redact.js";

/** Extract crash identity, current-thread frames and registers without interpreting analyzer text as commands. */
export function parseEspCoredumpReport(output: string) {
  if (Buffer.byteLength(output, "utf8") > 4 * 1024 * 1024)
    throw new PlatformIOError(
      "Core-dump analyzer output exceeds 4 MiB.",
      "COREDUMP_OUTPUT_LIMIT",
    );
  const cleaned = redactSecretsInText(output);
  const backtrace: string[] = [];
  const registers: Record<string, string> = Object.create(null);
  let crashedTask: string | null = null,
    reason: string | null = null;
  let section: "stack" | "registers" | null = null;
  let truncated = false;
  for (const line of cleaned.split(/\r?\n/)) {
    const value = line.trim();
    const task = /^Crashed task(?: handle)?:\s*(.*)$/.exec(value);
    if (task) crashedTask = task[1].slice(0, 4096);
    if (reason === null) {
      const description = /^(?:Panic reason|Exception cause):\s*(.*)$/.exec(
        value,
      );
      if (description) reason = description[1].slice(0, 4096);
      else if (
        value.startsWith("Program received signal") ||
        value.startsWith("Program terminated with signal") ||
        value.includes("panic'ed")
      )
        reason = value.slice(0, 4096);
    }
    const heading = /^={2,}\s*(.*?)\s*={2,}$/.exec(value);
    if (heading) {
      const title = heading[1].toUpperCase();
      section =
        title === "CURRENT THREAD STACK"
          ? "stack"
          : title === "CURRENT THREAD REGISTERS"
            ? "registers"
            : null;
      continue;
    }
    if (section === "stack" && /^#[0-9]+\s/.test(value)) {
      if (backtrace.length < 256) backtrace.push(value.slice(0, 4096));
      else truncated = true;
    }
    if (section === "registers") {
      const register = /^([A-Za-z][A-Za-z0-9_]{0,63})\s+(.+)$/.exec(value);
      if (register) {
        if (
          Object.keys(registers).length < 128 ||
          Object.hasOwn(registers, register[1])
        )
          registers[register[1]] = register[2].slice(0, 4096);
        else truncated = true;
      }
    }
    if (value.length > 4096) truncated = true;
  }
  return {
    crashed_task: crashedTask,
    reason,
    backtrace,
    registers,
    output: cleaned.slice(-12000),
    truncated: truncated || cleaned.length > 12000,
  };
}
