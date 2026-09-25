/** Operator-owned enrollment of exact project policy content and real workspace identity. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolvePolicyDirectory } from "./policy-sources.js";
import {
  parsePolicyDocument,
  PolicyProfileConfigSchema,
  PolicyConfigError,
} from "./policy-schema.js";

/** Project documents already read and validated by policy resolution. */
export interface ProjectPolicyDocuments {
  profile: unknown | null;
  override: unknown | null;
}
/** Real project identity and normalized policy digest. */
export interface ProjectEnrollmentIdentity {
  version: 1;
  project: string;
  digest: string;
}

/** Serializes policy maps deterministically; array order remains part of the enrolled document. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}

/** Binds normalized project documents to a real path, never an alias or current-directory guess. */
export function projectEnrollmentIdentity(
  project: string,
  documents: ProjectPolicyDocuments,
): ProjectEnrollmentIdentity {
  const realProject = fs.realpathSync(project);
  if (!fs.statSync(realProject).isDirectory())
    throw new PolicyConfigError(
      project,
      "Enrollment requires a project directory.",
    );
  const identity = { version: 1 as const, project: realProject };
  return {
    ...identity,
    digest: crypto
      .createHash("sha256")
      .update(canonical({ ...identity, documents }))
      .digest("hex"),
  };
}

/** Resolves existing ancestors so missing leaf paths cannot conceal a directory symlink. */
function realStoragePath(source: string): string {
  try {
    return fs.realpathSync(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(source);
    if (parent === source) throw error;
    return path.join(realStoragePath(parent), path.basename(source));
  }
}

/** Resolves an operator-owned per-project record, keeping policy storage outside the project. */
function recordPath(project: string): string {
  const directory = realStoragePath(
    path.join(path.resolve(resolvePolicyDirectory()), "project-enrollments"),
  );
  const relative = path.relative(project, directory);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  ) {
    throw new PolicyConfigError(
      directory,
      "Enrollment storage must be outside the project directory.",
    );
  }
  return path.join(
    directory,
    `${crypto.createHash("sha256").update(project).digest("hex")}.json`,
  );
}

/** Returns true only for the current exact version, real path and document digest. */
export function isProjectEnrolled(
  identity: ProjectEnrollmentIdentity,
): boolean {
  const source = recordPath(identity.project);
  try {
    const stat = fs.statSync(source);
    if (!stat.isFile() || stat.size > 4096)
      throw new Error("Invalid enrollment record");
    const record = JSON.parse(fs.readFileSync(source, "utf8"));
    if (
      record.version !== 1 ||
      typeof record.project !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.digest)
    )
      throw new Error("Invalid enrollment record");
    return (
      record.project === identity.project && record.digest === identity.digest
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new PolicyConfigError(
      source,
      "Invalid or unreadable enrollment record; revoke and enroll the reviewed project again.",
    );
  }
}

/** Reads both project sources with the same strict parsing rules used by policy resolution. */
function readDocuments(project: string): ProjectPolicyDocuments {
  const read = (relative: string) => {
    const source = path.join(project, relative);
    try {
      if (fs.statSync(source).size > 64 * 1024)
        throw new PolicyConfigError(source, "Policy exceeds 64 KiB.");
      return parsePolicyDocument(fs.readFileSync(source, "utf8"), source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  const profile = read(".pio-mcp-policy.json");
  const override = read(".pio-mcp-workspace/policy.yaml");
  if (profile !== null && !PolicyProfileConfigSchema.safeParse(profile).success)
    throw new PolicyConfigError(
      project,
      "Project profile requires a valid profile name.",
    );
  if (override !== null && "profile" in override)
    throw new PolicyConfigError(
      project,
      "Workspace policy must contain overrides only.",
    );
  return { profile, override };
}

/** Explicit operator CLI enrollment; never registered as an MCP or dashboard operation. */
export function enrollProjectPolicy(
  project: string,
): ProjectEnrollmentIdentity {
  const identity = projectEnrollmentIdentity(project, readDocuments(project));
  const source = recordPath(identity.project);
  fs.mkdirSync(path.dirname(source), { recursive: true, mode: 0o700 });
  const temporary = `${source}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(identity) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, source);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return identity;
}

/** Revokes the operator's record for a real project without changing project files. */
export function revokeProjectPolicy(project: string): void {
  fs.rmSync(recordPath(fs.realpathSync(project)), { force: true });
}
