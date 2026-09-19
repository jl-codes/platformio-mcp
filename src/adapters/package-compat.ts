/**
 * Pinned Python-reference package argument mapping to canonical package actions.
 * Provides mapPackageCompatibilityRequest; execution must still use executePackageAction and its policy boundary.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { PlatformIOError } from "../utils/errors.js";
import type { PackageAction } from "../tools/packages.js";

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
