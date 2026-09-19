/**
 * Shared modern package handlers with strict scopes and retained command evidence.
 * Provides executePackageAction and PackageAction for MCP and CLI adapters.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { platformioExecutor } from "../platformio.js";
import { PlatformIOError } from "../utils/errors.js";
import { dispatchAuthorizedAction } from "../core/action-dispatcher.js";
import { createPolicyRevisionGuard } from "../core/policy/revision-guard.js";
import { redactSecretsInText } from "../core/policy/redact.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";
import { mergePackageConfiguration } from "../core/package-config.js";
import { parsePackageList, parsePackageSearch } from "../core/packages.js";

/** Implemented canonical modern package operations. */
export type PackageAction =
  | "pkg_search"
  | "pkg_install"
  | "pkg_uninstall"
  | "pkg_list"
  | "pkg_outdated"
  | "pkg_update";
const argument = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine(
    (value) => !/[\x00-\x1f\x7f]/.test(value),
    "Control characters are not allowed",
  );
const scope = {
  projectDir: argument,
  environment: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/)
    .optional(),
  approvalId: z.string().optional(),
};
const kind = z.enum(["library", "platform", "tool"]).default("library");
const searchSchema = z
  .object({
    query: z
      .string()
      .trim()
      .max(4096)
      .refine(
        (value) => !/[\x00-\x1f\x7f]/.test(value),
        "Control characters are not allowed",
      ),
    kind,
    page: z.number().int().min(1).max(100000).default(1),
    approvalId: z.string().optional(),
  })
  .strict();
const projectSchema = z.object(scope).strict();
const mutationSchema = z
  .object({
    ...scope,
    kind,
    spec: argument.refine(
      (value) => !value.startsWith("-"),
      "Package specification cannot be an option",
    ),
  })
  .strict();

/** Redact URL credentials in addition to the existing application-secret patterns. */
function safeOutput(text: string): string {
  return redactSecretsInText(
    text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@"),
  );
}

/** Only hashes of the configuration are retained; contents may contain credentials. */
async function readConfiguration(projectDir: string): Promise<string | null> {
  const file = await fs
    .open(path.join(projectDir, "platformio.ini"), "r")
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  if (!file) return null;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024)
      throw new PlatformIOError(
        "Project configuration exceeds 1 MiB or is not a regular file.",
        "PACKAGE_CONFIG_INVALID",
      );
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await file.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > 1024 * 1024)
      throw new PlatformIOError(
        "Project configuration grew beyond 1 MiB.",
        "PACKAGE_CONFIG_INVALID",
      );
    return buffer.subarray(0, length).toString("utf8");
  } finally {
    await file.close();
  }
}

/** Writes a new private completed log, rejecting project log-directory escapes. */
async function retainOutput(
  projectDir: string,
  output: string,
): Promise<string> {
  const dir = path.join(projectDir, ".pio-mcp-workspace", "logs", "packages");
  // Check each ancestor before creating its child, so a preexisting symlink cannot redirect writes.
  let current = projectDir;
  for (const component of [".pio-mcp-workspace", "logs", "packages"]) {
    current = path.join(current, component);
    await fs
      .mkdir(current, { mode: 0o700 })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    const actual = await fs.realpath(current);
    const relative = path.relative(projectDir, actual);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new PlatformIOError(
        "Package log directory escapes the project.",
        "PACKAGE_LOG_PATH_INVALID",
      );
  }
  const file = path.join(dir, `packages-${crypto.randomUUID()}.log`);
  await fs.writeFile(file, output, { flag: "wx", mode: 0o600 });
  // Only completed package logs share this prefix; the project lock excludes active writers.
  const completed = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^packages-[a-f0-9-]{36}\.log$/.test(entry.name))
      continue;
    const candidate = path.join(dir, entry.name);
    if (candidate === file) continue;
    const stat = await fs.lstat(candidate);
    if (stat.isFile()) completed.push({ path: candidate, time: stat.mtimeMs });
  }
  for (const stale of completed.sort((a, b) => b.time - a.time).slice(199))
    await fs.unlink(stale.path);
  return file;
}

/**
 * Execute one validated project package action; legacy library commands are unchanged.
 * Installed platform code can run during list/outdated, so those actions require build permission.
 */
export async function executePackageAction(
  action: PackageAction,
  input: unknown,
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
  outputOptions: { tailLines?: 40 | 60 } = {},
) {
  const tailLines = outputOptions.tailLines ?? 40;
  if (tailLines !== 40 && tailLines !== 60)
    throw new PlatformIOError(
      "Invalid package output limit.",
      "PACKAGE_OUTPUT_LIMIT",
    );
  if (
    ![
      "pkg_search",
      "pkg_install",
      "pkg_uninstall",
      "pkg_list",
      "pkg_outdated",
      "pkg_update",
    ].includes(action)
  )
    throw new PlatformIOError("Unknown package operation.", "UNKNOWN_ACTION");
  const search = action === "pkg_search";
  const mutation = action === "pkg_install" || action === "pkg_uninstall";
  const parsed = search
    ? searchSchema.parse(input)
    : mutation
      ? mutationSchema.parse(input)
      : projectSchema.parse(input);
  const projectDir =
    "projectDir" in parsed ? await fs.realpath(parsed.projectDir) : undefined;
  const params: {
    projectDir?: string;
    environment?: string;
    approvalId?: string;
    spec?: string;
    kind?: "library" | "platform" | "tool";
    query?: string;
    page?: number;
  } = { ...parsed, ...(projectDir ? { projectDir } : {}) };
  if (
    params.spec !== undefined &&
    (/[a-z][a-z0-9+.-]*:\/\/[^\s/@]+@/i.test(params.spec) ||
      /[?&](?:token|password|key|secret|signature)=/i.test(params.spec))
  )
    throw new PlatformIOError(
      "Use an external credential helper instead of credentials in package URLs.",
      "PACKAGE_SPEC_SECRET",
    );
  const context = {
    ...caller,
    workspaceDir: projectDir ?? caller.workspaceDir,
  };
  return dispatchAuthorizedAction(action, params, context, async () => {
    const validatePolicy = createPolicyRevisionGuard(context.workspaceDir);
    await onAuthorized?.();
    validatePolicy();
    const release = projectDir
      ? await lockfile.lock(projectDir, {
          realpath: true,
          lockfilePath: path.join(projectDir, ".pio-mcp-packages.lock"),
          retries: 0,
        })
      : undefined;
    try {
      validatePolicy();
      const before = projectDir ? await readConfiguration(projectDir) : null;
      const configPath =
        projectDir && before !== null
          ? await fs.realpath(path.join(projectDir, "platformio.ini"))
          : undefined;
      if (projectDir && configPath) {
        const relative = path.relative(projectDir, configPath);
        if (
          relative === ".." ||
          relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative)
        )
          throw new PlatformIOError(
            "Project configuration resolves outside the project.",
            "PACKAGE_CONFIG_CONFLICT",
          );
      }
      const keys =
        !mutation && action !== "pkg_update"
          ? []
          : params.kind === "platform"
            ? ["platform"]
            : params.kind === "tool"
              ? ["platform_packages"]
              : params.kind === "library"
                ? ["lib_deps"]
                : ["lib_deps", "platform", "platform_packages"];
      if (before !== null)
        mergePackageConfiguration(before, before, {
          environment: params.environment,
          keys,
        });
      const args = [action.slice(4)];
      if ("query" in params)
        args.push(
          `type:${params.kind} ${params.query}`.trim(),
          "--page",
          String(params.page),
        );
      if (projectDir) args.push("--project-dir", projectDir);
      if ("environment" in params && params.environment)
        args.push("--environment", params.environment);
      if (params.spec !== undefined) args.push(`--${params.kind}`, params.spec);
      validatePolicy();
      const result = await platformioExecutor.execute("pkg", args, {
        cwd: projectDir,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        timeout: search
          ? 90000
          : action === "pkg_install" || action === "pkg_update"
            ? 900000
            : 300000,
      });
      // Keep nonzero exit status and bounded output; never call failed mutations successful.
      if (!Number.isInteger(result.exitCode))
        throw new PlatformIOError(
          "Package command did not return a numeric exit status.",
          "PACKAGE_PROCESS_ERROR",
        );
      const output = safeOutput(
        [result.stdout, result.stderr].filter(Boolean).join("\n"),
      );
      if (Buffer.byteLength(output) > 20 * 1024 * 1024)
        throw new PlatformIOError(
          "Package output exceeds 20 MiB.",
          "PACKAGE_OUTPUT_LIMIT",
        );
      const logPath = projectDir
        ? await retainOutput(projectDir, output)
        : null;
      let after = projectDir ? await readConfiguration(projectDir) : null;
      if (projectDir && before !== null && after !== null && before !== after) {
        const merged = mergePackageConfiguration(before, after, {
          environment: params.environment,
          keys,
        });
        validatePolicy();
        if (
          configPath !==
            (await fs.realpath(path.join(projectDir, "platformio.ini"))) ||
          after !== (await readConfiguration(projectDir))
        )
          throw new PlatformIOError(
            "Configuration changed concurrently; inspect it before retrying.",
            "PACKAGE_CONFIG_CONFLICT",
          );
        if (merged !== after) {
          const temp = `${configPath}.${crypto.randomUUID()}.tmp`;
          try {
            await fs.writeFile(temp, merged, {
              flag: "wx",
              mode: (await fs.stat(configPath!)).mode,
            });
            if (after !== (await readConfiguration(projectDir)))
              throw new PlatformIOError(
                "Configuration changed concurrently.",
                "PACKAGE_CONFIG_CONFLICT",
              );
            await fs.rename(temp, configPath!);
          } finally {
            await fs.unlink(temp).catch(() => {});
          }
          after = merged;
        }
      }
      const digest = (text: string | null) =>
        text === null
          ? null
          : crypto.createHash("sha256").update(text).digest("hex");
      validatePolicy();
      const detail =
        action === "pkg_search"
          ? parsePackageSearch(safeOutput(result.stdout))
          : action === "pkg_list"
            ? parsePackageList(safeOutput(result.stdout))
            : undefined;
      const parsedOk = !detail || detail.parseStatus === "complete";
      const ok = result.exitCode === 0 && parsedOk;
      return {
        ok,
        action,
        exitCode: result.exitCode,
        summary:
          result.exitCode !== 0
            ? `${action} failed (exit ${result.exitCode}).`
            : !parsedOk
              ? `${action} completed, but its output was not fully recognized.`
              : `${action} completed${detail ? `: ${detail.packages.length} package(s) returned` : ""}.`,
        ...(ok
          ? {}
          : {
              error:
                result.exitCode !== 0
                  ? "PACKAGE_COMMAND_FAILED"
                  : "PACKAGE_OUTPUT_UNRECOGNIZED",
            }),
        projectDir,
        environment: "environment" in params ? params.environment : undefined,
        outputTail: output
          .split(/\r?\n/)
          .slice(-tailLines)
          .join("\n")
          .slice(-32768),
        logPath,
        ...(projectDir
          ? {
              configuration: {
                beforeSha256: digest(before),
                afterSha256: digest(after),
                changed: before !== after,
              },
            }
          : {}),
        ...detail,
      };
    } finally {
      await release?.();
    }
  });
}
