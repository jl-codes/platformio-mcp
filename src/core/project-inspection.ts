/**
 * Bounded computed project configuration and build metadata views.
 * Provides parseProjectEnvironments and parseProjectMetadata using PlatformIO's resolved JSON.
 */
import { z } from "zod";
import { partitionFrameworkCandidates } from "./esp-partition-framework.js";
import { PlatformIOError } from "../utils/errors.js";
import { redactSecretsInText } from "./policy/redact.js";

const text = z.string().max(65536);
const value = z.union([
  text,
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(text).max(10000),
]);
const configSchema = z
  .array(
    z.tuple([
      z.string().max(256),
      z.array(z.tuple([z.string().max(256), value])).max(2048),
    ]),
  )
  .max(512);
const targetSchema = z.object({
  name: z.string().min(1).max(256),
  title: text.nullish(),
  description: text.nullish(),
  group: text.nullish(),
});
const metadataSchema = z.record(
  z
    .object({
      env_name: z.string().optional(),
      build_type: text.nullish(),
      defines: z.array(text).max(10000).optional(),
      includes: z
        .object({
          build: z.array(text).max(10000).optional(),
          toolchain: z.array(text).max(10000).optional(),
        })
        .passthrough()
        .nullish(),
      libsource_dirs: z.array(text).max(4096).optional(),
      cc_path: text.nullish(),
      cxx_path: text.nullish(),
      gdb_path: text.nullish(),
      prog_path: text.nullish(),
      svd_path: text.nullish(),
      compiler_type: text.nullish(),
      cc_flags: z.array(text).max(10000).optional(),
      cxx_flags: z.array(text).max(10000).optional(),
      targets: z.array(targetSchema).max(2048).optional(),
      extra: z.unknown().optional(),
    })
    .passthrough(),
);

/** Parse bounded JSON and remove well-known secret values before projecting reports. */
function readJson(output: string): unknown {
  if (Buffer.byteLength(output) > 10 * 1024 * 1024)
    throw new PlatformIOError(
      "Project output exceeds 10 MiB.",
      "PROJECT_OUTPUT_LIMIT",
    );
  let raw: unknown;
  try {
    raw = JSON.parse(output);
  } catch {
    throw new PlatformIOError(
      "Project output is not valid JSON.",
      "PROJECT_OUTPUT_INVALID",
    );
  }
  let nodes = 0;
  const clean = (item: unknown, depth: number): unknown => {
    if (++nodes > 100000 || depth > 24)
      throw new PlatformIOError(
        "Project output exceeds structural limits.",
        "PROJECT_OUTPUT_LIMIT",
      );
    if (typeof item === "string") return redactSecretsInText(item);
    if (Array.isArray(item))
      return item.map((child) => clean(child, depth + 1));
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([key, child]) => [
          key,
          depth > 0 &&
          /(?:password|passphrase|api[_-]?key|secret|access[_-]?token)/i.test(
            key,
          )
            ? "[REDACTED_SECRET]"
            : clean(child, depth + 1),
        ]),
      );
    return item;
  };
  return clean(raw, 0);
}

/** Preserve resolved inheritance from Core rather than implementing a competing INI resolver. */
export function parseProjectEnvironments(output: string) {
  const parsed = configSchema.safeParse(readJson(output));
  if (!parsed.success)
    throw new PlatformIOError(
      "Unexpected computed configuration shape.",
      "PROJECT_CONFIG_INVALID",
    );
  const sections = new Map<string, Record<string, z.infer<typeof value>>>();
  for (const [name, options] of parsed.data) {
    if (
      sections.has(name) ||
      new Set(options.map(([key]) => key)).size !== options.length
    )
      throw new PlatformIOError(
        "Duplicate computed configuration section or option.",
        "PROJECT_CONFIG_INVALID",
      );
    sections.set(
      name,
      Object.fromEntries(
        options.map(([key, field]) => [
          key,
          /(?:password|passphrase|api[_-]?key|secret|access[_-]?token)/i.test(
            key,
          )
            ? "[REDACTED_SECRET]"
            : field,
        ]),
      ),
    );
  }
  const envs = [...sections.entries()]
    .filter(([name]) => name.startsWith("env:"))
    .map(([section, options]) => ({
      name: section.slice(4),
      board: options.board ?? null,
      platform: options.platform ?? null,
      framework: options.framework ?? null,
      monitorSpeed: options.monitor_speed ?? null,
      monitorPort: options.monitor_port ?? null,
      uploadPort: options.upload_port ?? null,
      uploadProtocol: options.upload_protocol ?? null,
      partitionTable: options["board_build.partitions"] ?? null,
      sdkconfigPath: options["board_build.esp-idf.sdkconfig_path"] ?? null,
      partitionTableUploadOffset: options["board_upload.partition_table_offset"] ?? null,
      flashSize: options["board_upload.flash_size"] ?? null,
      mcu: options["board_build.mcu"] ?? null,
      libraryDependencies: options.lib_deps ?? [],
      libraryExtraDirectories: options.lib_extra_dirs ?? [],
      libraryDependencyFinderMode: options.lib_ldf_mode ?? null,
      libraryCompatibilityMode: options.lib_compat_mode ?? null,
      buildFlags: options.build_flags ?? [],
      extends: options.extends ?? [],
    }));
  if (envs.length > 256 || envs.some((env) => !env.name))
    throw new PlatformIOError(
      "Invalid environment inventory.",
      "PROJECT_CONFIG_INVALID",
    );
  const platformioSection = sections.get("platformio") ?? {};
  const rawDefaults = platformioSection.default_envs;
  const defaults =
    typeof rawDefaults === "string"
      ? rawDefaults
          .split(/[,\r\n]/)
          .map((item) => item.trim())
          .filter(Boolean)
      : Array.isArray(rawDefaults)
        ? rawDefaults
        : rawDefaults == null
          ? []
          : undefined;
  if (
    !defaults ||
    defaults.some((name) => !envs.some((env) => env.name === name))
  )
    throw new PlatformIOError(
      "Default environments do not match the resolved inventory.",
      "PROJECT_CONFIG_INVALID",
    );
  return {
    envs,
    defaultEnvironments: defaults.length
      ? defaults
      : envs.map((env) => env.name),
    platformioSection,
  };
}

/** Select explicit metadata or return all environments; never pick the first unrelated one. */
export function parseProjectMetadata(output: string, environment?: string) {
  const parsed = metadataSchema.safeParse(readJson(output));
  if (!parsed.success)
    throw new PlatformIOError(
      "Unexpected build metadata shape.",
      "PROJECT_METADATA_INVALID",
    );
  const entries = Object.entries(parsed.data);
  if (
    entries.length < 1 ||
    entries.length > 256 ||
    (environment && (entries.length !== 1 || entries[0][0] !== environment))
  )
    throw new PlatformIOError(
      "Metadata does not match the selected environments.",
      "PROJECT_METADATA_INVALID",
    );
  const envs = Object.fromEntries(
    entries.map(([name, item]) => {
      if (!name || (item.env_name && item.env_name !== name))
        throw new PlatformIOError(
          "Metadata environment identity disagrees with its key.",
          "PROJECT_METADATA_INVALID",
        );
      return [
        name,
        {
          buildType: item.build_type ?? null,
          defines: item.defines ?? [],
          includeDirs: item.includes?.build?.slice(0, 40) ?? [],
          partitionFrameworkCandidates: partitionFrameworkCandidates(item.includes?.build ?? []),
          includeDirCount: item.includes?.build?.length ?? 0,
          toolchainIncludeDirCount: item.includes?.toolchain?.length ?? 0,
          librarySourceDirs: item.libsource_dirs ?? [],
          cc: item.cc_path ?? null,
          cxx: item.cxx_path ?? null,
          gdb: item.gdb_path ?? null,
          compilerType: item.compiler_type ?? null,
          ccFlags: item.cc_flags ?? [],
          cxxFlags: item.cxx_flags ?? [],
          programPath: item.prog_path ?? null,
          svdPath: item.svd_path ?? null,
          extra: item.extra ?? null,
          targets: item.targets ?? [],
          targetsAvailable: item.targets !== undefined,
        },
      ];
    }),
  );
  return {
    envs,
    targets: Object.entries(envs).flatMap(([name, item]) =>
      item.targets.map((target) => ({ environment: name, ...target })),
    ),
    targetsAvailable: Object.values(envs).every(
      (item) => item.targetsAvailable,
    ),
  };
}
