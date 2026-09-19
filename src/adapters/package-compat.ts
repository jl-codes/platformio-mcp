/**
 * Pinned Python-reference package argument mapping to canonical package actions.
 * Provides mapPackageCompatibilityRequest; execution must still use executePackageAction and its policy boundary.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { PlatformIOError } from "../utils/errors.js";
import { executePackageAction, type PackageAction } from "../tools/packages.js";
import type { PolicyEvaluationContext } from "../core/policy/types.js";

const text = z
  .string()
  .max(4096)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value));
const scope = {
  project_dir: text.nullable().optional(),
  env: text.nullable().optional(),
  approval_id: text.optional(),
};
const kind = z.enum(["library", "platform", "tool"]).default("library");
const schemas = {
  pio_pkg_search: z
    .object({
      query: text,
      type: kind,
      page: z.number().int().min(1).max(100000).default(1),
      approval_id: text.optional(),
    })
    .strict(),
  pio_pkg_install: z
    .object({
      ...scope,
      spec: text.refine((value) => value.length > 0),
      type: kind,
    })
    .strict(),
  pio_pkg_uninstall: z
    .object({
      ...scope,
      spec: text.refine((value) => value.length > 0),
      type: kind,
    })
    .strict(),
  pio_pkg_list: z.object(scope).strict(),
  pio_pkg_outdated: z.object(scope).strict(),
  pio_pkg_update: z.object(scope).strict(),
};
/** Exactly the six package names in the frozen reference registry. */
export type PackageCompatibilityName = keyof typeof schemas;
/** Launch-owned defaults; public requests must not supply the environment or process directory. */
export interface PackageCompatibilityDefaults {
  projectDir?: string;
  cwd?: string;
  home?: string;
}

/** Resolve the reference's explicit path, launch default, then cwd, requiring a PlatformIO project. */
async function projectDirectory(
  requested: string | null | undefined,
  defaults: PackageCompatibilityDefaults,
): Promise<string> {
  let selected =
    requested || defaults.projectDir || defaults.cwd || process.cwd();
  if (
    selected === "~" ||
    selected.startsWith("~/") ||
    selected.startsWith("~\\")
  )
    selected = path.join(defaults.home ?? os.homedir(), selected.slice(2));
  else if (selected.startsWith("~"))
    throw new PlatformIOError(
      "Named-user home expansion is unsupported; pass an absolute project path.",
      "COMPAT_PROJECT_INVALID",
    );
  const canonical = await fs.realpath(
    path.resolve(defaults.cwd ?? process.cwd(), selected),
  );
  if (
    !(await fs.stat(canonical)).isDirectory() ||
    !(await fs.stat(path.join(canonical, "platformio.ini"))).isFile()
  )
    throw new PlatformIOError(
      "Expected a PlatformIO project directory.",
      "COMPAT_PROJECT_INVALID",
    );
  return canonical;
}

/** Validate the reference vocabulary and map names only; no subprocess, policy grant or package mutation occurs. */
export async function mapPackageCompatibilityRequest(
  name: string,
  input: unknown,
  defaults: PackageCompatibilityDefaults = {},
): Promise<{ action: PackageAction; args: Record<string, unknown> }> {
  if (!Object.hasOwn(schemas, name))
    throw new PlatformIOError(
      "Unknown package compatibility tool.",
      "COMPAT_TOOL_UNKNOWN",
    );
  const parsed = schemas[name as PackageCompatibilityName].safeParse(input);
  if (!parsed.success)
    throw new PlatformIOError(
      "Invalid package compatibility arguments.",
      "COMPAT_ARGUMENT_INVALID",
    );
  const args = parsed.data;
  const action = name.slice(4) as PackageAction;
  if ("query" in args)
    return {
      action,
      args: {
        query: args.query,
        kind: args.type,
        page: args.page,
        ...(args.approval_id ? { approvalId: args.approval_id } : {}),
      },
    };
  return {
    action,
    args: {
      projectDir: await projectDirectory(args.project_dir, defaults),
      ...(args.env ? { environment: args.env } : {}),
      ...("spec" in args && "type" in args
        ? { spec: args.spec, kind: args.type }
        : {}),
      ...(args.approval_id ? { approvalId: args.approval_id } : {}),
    },
  };
}

/** Adapt completed canonical evidence without converting failures or unrecognized output into success. */
export function packageCompatibilityResult(
  result: Awaited<ReturnType<typeof executePackageAction>>,
) {
  const tail = (lines: number) =>
    result.outputTail.split("\n").slice(-lines).join("\n");
  const common = {
    ok: result.ok,
    summary: result.summary,
    log_path: result.logPath ?? null,
    ...(result.error ? { error: result.error } : {}),
    details: {
      action: result.action,
      exit_code: result.exitCode,
      ...(result.parseStatus ? { parse_status: result.parseStatus } : {}),
      ...(result.configuration ? { configuration: result.configuration } : {}),
    },
  };
  switch (result.action) {
    case "pkg_search":
      return {
        ...common,
        packages: result.packages ?? [],
        total: "total" in result ? (result.total ?? null) : null,
        page: "page" in result ? (result.page ?? null) : null,
        pages: "pages" in result ? (result.pages ?? null) : null,
        ...(result.ok
          ? {
              install_hint:
                "install with pio_pkg_install(spec='owner/name@^version')",
            }
          : {}),
      };
    case "pkg_list":
      return {
        ...common,
        packages: result.packages ?? [],
        output_tail: tail(40),
      };
    case "pkg_outdated":
      return { ...common, output: tail(60) };
    case "pkg_install":
      return { ...common, output_tail: tail(result.ok ? 15 : 30) };
    case "pkg_uninstall":
      return { ...common, output_tail: tail(15) };
    case "pkg_update":
      return { ...common, output_tail: tail(40) };
  }
}

/** Route aliases through the canonical policy/locking implementation; authorization errors remain errors. */
export async function executePackageCompatibility(
  name: string,
  input: unknown,
  defaults: PackageCompatibilityDefaults = {},
  caller: PolicyEvaluationContext = {},
  onAuthorized?: () => Promise<void>,
) {
  const mapped = await mapPackageCompatibilityRequest(name, input, defaults);
  const result = await executePackageAction(
    mapped.action,
    mapped.args,
    caller,
    onAuthorized,
    { tailLines: mapped.action === "pkg_outdated" ? 60 : 40 },
  );
  return packageCompatibilityResult(result);
}
