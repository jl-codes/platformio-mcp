/** Bounded package declaration and manifest parsing for dependency audit evidence. */
import { z } from "zod";
import type { DependencyDeclaration } from "./dependency-audit.js";
import { PlatformIOError } from "../utils/errors.js";
import { redactSecretsInText } from "./policy/redact.js";

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value));
/** Validated library manifest fields; omitted dependencies mean an empty declared manifest graph. */
export interface DependencyManifest {
  name: string | null;
  version: string | null;
  dependencies: string[];
}
/** Parse registry constraints without mistaking URL credentials or local paths for registry identities. */
export function parseDependencyDeclaration(
  input: string,
): DependencyDeclaration {
  if (input.length > 4096 || /[\x00-\x1f\x7f]/.test(input))
    throw new PlatformIOError(
      "Invalid dependency declaration.",
      "DEPENDENCY_SPEC_INVALID",
    );
  const spec = input.trim();
  const safe = redactSecretsInText(spec);
  if (
    /^(?:file|symlink):/i.test(spec) ||
    /^(?:\.{1,2}[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(spec)
  )
    return { spec: safe, name: null, kind: "local", constrained: false };
  if (/^(?:git|hg|svn)(?:\+[^:]+)?:/i.test(spec) || /^git@/i.test(spec))
    return { spec: safe, name: null, kind: "vcs", constrained: false };
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec))
    return { spec: safe, name: null, kind: "unknown", constrained: false };
  const match = /^(?:([A-Za-z0-9_.-]+)\/)?([^@/\\]+?)(?:@(.+))?$/.exec(spec);
  if (!match || !nameSchema.safeParse(match[2]).success)
    return { spec: safe, name: null, kind: "unknown", constrained: false };
  return {
    spec: safe,
    name: match[2].trim(),
    kind: "registry",
    constrained: !!match[3]?.trim(),
  };
}
/** Parse library.json or Arduino library.properties, rejecting malformed evidence rather than inventing empty manifests. */
export function parseDependencyManifest(
  text: string,
  format: "json" | "properties",
): DependencyManifest {
  if (Buffer.byteLength(text) > 1024 * 1024)
    throw new PlatformIOError(
      "Library manifest exceeds 1 MiB.",
      "DEPENDENCY_MANIFEST_LIMIT",
    );
  try {
    let rawName: unknown, rawVersion: unknown;
    const dependencies: string[] = [];
    const add = (value: unknown) => {
      dependencies.push(nameSchema.parse(value));
      if (dependencies.length > 512) throw new Error("Too many dependencies");
    };
    if (format === "json") {
      const data = z
        .object({
          name: nameSchema.nullish(),
          version: z
            .union([z.string().max(512), z.number().finite()])
            .nullish(),
          dependencies: z.unknown().optional(),
        })
        .parse(JSON.parse(text));
      rawName = data.name;
      rawVersion = data.version;
      if (Array.isArray(data.dependencies)) {
        for (const item of data.dependencies) {
          if (typeof item === "string") add(item);
          else add(z.object({ name: nameSchema }).parse(item).name);
        }
      } else if (data.dependencies && typeof data.dependencies === "object") {
        for (const [key, value] of Object.entries(data.dependencies)) {
          if (
            typeof value !== "string" &&
            !(value && typeof value === "object" && !Array.isArray(value))
          )
            throw new Error("Invalid dependency mapping");
          // Registry owners qualify lookup, while installed manifests declare library names.
          add(key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key);
        }
      } else if (data.dependencies !== undefined && data.dependencies !== null)
        throw new Error("Invalid dependencies");
    } else {
      const fields = new Map<string, string>();
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const at = line.indexOf("=");
        if (at < 1) continue;
        const key = line.slice(0, at).trim();
        if (["name", "version", "depends"].includes(key)) {
          if (fields.has(key)) throw new Error("Duplicate manifest field");
          fields.set(key, line.slice(at + 1).trim());
        }
      }
      rawName = fields.get("name");
      rawVersion = fields.get("version");
      for (const item of (fields.get("depends") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)) {
        const match = /^([^()]+?)(?:\s*\([^()]*\))?$/.exec(item);
        if (!match) throw new Error("Invalid dependency constraint");
        add(match[1]);
      }
    }
    return {
      name: rawName == null ? null : nameSchema.parse(rawName),
      version:
        rawVersion == null
          ? null
          : z.string().max(512).parse(String(rawVersion)),
      dependencies: [...new Set(dependencies)],
    };
  } catch {
    throw new PlatformIOError(
      "Invalid library manifest; dependency evidence is incomplete.",
      "DEPENDENCY_MANIFEST_INVALID",
    );
  }
}
