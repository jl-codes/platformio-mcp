/** Validate PlatformIO check JSON and summarize defects without accepting missing reports as success. */
import path from "node:path";
import { z } from "zod";
import { PlatformIOError } from "../../utils/errors.js";

const optionalText = z.string().max(65536).nullable().optional();
const defectSchema = z.object({
  severity: z.string().max(64).default("low"),
  category: optionalText,
  id: optionalText,
  message: optionalText,
  file: optionalText,
  line: z.number().int().nonnegative().nullable().optional(),
  column: z.number().int().nonnegative().nullable().optional(),
  cwe: z
    .union([z.string().max(1024), z.number().int()])
    .nullable()
    .optional(),
});
const reportSchema = z
  .array(
    z.object({
      env: optionalText,
      tool: optionalText,
      succeeded: z.boolean(),
      duration: z.number().finite().nonnegative().default(0),
      defects: z.array(defectSchema).max(100000).default([]),
    }),
  )
  .max(1024);

/** Parse a complete, bounded report and retain totals independently of its eventual presentation. */
export function summarizeCheckOutput(output: string, projectDir: string) {
  if (Buffer.byteLength(output) > 16 * 1024 * 1024)
    throw new PlatformIOError(
      "Static analysis report exceeds 16 MiB",
      "CHECK_REPORT_LIMIT",
    );
  const start = output.indexOf("[");
  if (start < 0)
    throw new PlatformIOError(
      "Static analysis returned no JSON report",
      "CHECK_REPORT_INVALID",
    );
  let raw: unknown;
  try {
    raw = JSON.parse(output.slice(start).trim());
  } catch {
    throw new PlatformIOError(
      "Static analysis returned malformed JSON",
      "CHECK_REPORT_INVALID",
    );
  }
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success)
    throw new PlatformIOError(
      "Static analysis report has an invalid shape",
      "CHECK_REPORT_INVALID",
    );
  const bySeverity: Record<string, number> = { high: 0, medium: 0, low: 0 };
  const tools = parsed.data.map((entry) => ({
    env: entry.env ?? null,
    tool: entry.tool ?? null,
    succeeded: entry.succeeded,
    duration_s: Math.round(entry.duration * 100) / 100,
  }));
  const defects = parsed.data.flatMap((entry) =>
    entry.defects.map((defect) => {
      Object.defineProperty(bySeverity, defect.severity, {
        value:
          (Object.hasOwn(bySeverity, defect.severity)
            ? bySeverity[defect.severity]
            : 0) + 1,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      let file = defect.file || "";
      const paths = /^[a-z]:[\\/]/i.test(projectDir) ? path.win32 : path.posix;
      if (file && paths.isAbsolute(file)) {
        const relative = paths.relative(projectDir, file);
        if (
          relative !== ".." &&
          !relative.startsWith(".." + paths.sep) &&
          !paths.isAbsolute(relative)
        )
          file = relative;
      }
      return {
        severity: defect.severity,
        category: defect.category ?? null,
        id: defect.id ?? null,
        message: defect.message ?? null,
        file,
        line: defect.line ?? null,
        column: defect.column ?? null,
        cwe: defect.cwe ?? null,
        tool: entry.tool ?? null,
        env: entry.env ?? null,
      };
    }),
  );
  const rank = (severity: string) =>
    severity === "high"
      ? 0
      : severity === "medium"
        ? 1
        : severity === "low"
          ? 2
          : 3;
  defects.sort(
    (a, b) =>
      rank(a.severity) - rank(b.severity) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      (a.line ?? 0) - (b.line ?? 0),
  );
  return {
    defect_count: defects.length,
    by_severity: bySeverity,
    tools,
    defects,
  };
}
