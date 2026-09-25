/**
 * Preserve project INI text around PlatformIO-produced dependency changes.
 * Provides mergePackageConfiguration; ambiguous edits fail instead of replacing unrelated settings.
 */
import { PlatformIOError } from "../utils/errors.js";

interface Entry {
  key: string;
  start: number;
  end: number;
  value: string;
}
interface Section {
  name: string;
  end: number;
  entries: Map<string, Entry>;
}
interface Document {
  lines: string[];
  sections: Map<string, Section>;
  newline: string;
}

/** Strip only INI comments beginning at start of value or following whitespace. */
function uncomment(value: string): string {
  return value.replace(/(^|\s)[#;].*$/, "").trim();
}
function invalid(): never {
  throw new PlatformIOError(
    "Package configuration has ambiguous syntax or unexpected non-dependency changes; inspect platformio.ini before retrying.",
    "PACKAGE_CONFIG_CONFLICT",
  );
}
/** Bounded line scanner for ConfigParser-style sections, options and indented continuations. */
function parse(text: string): Document {
  if (Buffer.byteLength(text) > 1024 * 1024) invalid();
  const lines = text.split(/\r?\n/);
  const sections = new Map<string, Section>();
  let section: Section | undefined;
  let entry: Entry | undefined;
  let optionIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*[#;]/.test(line)) continue;
    const heading = line.match(/^\s*\[([^\]]+)\]\s*(?:[#;].*)?$/);
    if (heading) {
      if (sections.has(heading[1])) invalid();
      if (section) section.end = i;
      section = { name: heading[1], end: lines.length, entries: new Map() };
      sections.set(section.name, section);
      entry = undefined;
      continue;
    }
    if (!section) invalid();
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (entry && indent > optionIndent) {
      entry.value += "\n" + uncomment(line);
      entry.end = i + 1;
      continue;
    }
    const option = line.match(/^\s*([^:=\s][^:=]*?)\s*[:=]\s*(.*)$/);
    if (!option) invalid();
    const key = option[1].trim().toLowerCase();
    if (section.entries.has(key)) invalid();
    entry = { key, start: i, end: i + 1, value: uncomment(option[2]) };
    section.entries.set(key, entry);
    optionIndent = indent;
  }
  for (const section of sections.values())
    for (const entry of section.entries.values())
      entry.value = entry.value.trim();
  return { lines, sections, newline: text.includes("\r\n") ? "\r\n" : "\n" };
}

/**
 * Keep original text except authorized dependency options changed by PlatformIO.
 * Does not compute package versions or inheritance; those remain PlatformIO's responsibility.
 */
export function mergePackageConfiguration(
  before: string,
  after: string,
  options: {
    environment?: string;
    keys: readonly string[];
  },
): string {
  const original = parse(before),
    updated = parse(after);
  if (original.sections.size !== updated.sections.size) invalid();
  const edits: { start: number; end: number; lines: string[] }[] = [];
  for (const [name, section] of original.sections) {
    const next = updated.sections.get(name);
    if (!next) invalid();
    for (const key of new Set([
      ...section.entries.keys(),
      ...next.entries.keys(),
    ])) {
      const oldEntry = section.entries.get(key),
        newEntry = next.entries.get(key);
      if (oldEntry?.value === newEntry?.value) continue;
      if (
        !name.startsWith("env:") ||
        (options.environment && name !== `env:${options.environment}`) ||
        !options.keys.includes(key)
      )
        invalid();
      const comments: string[] = [];
      if (oldEntry)
        for (const line of original.lines.slice(oldEntry.start, oldEntry.end)) {
          if (/^\s*[#;]/.test(line)) comments.push(line);
          else {
            const comment = line.match(/\s([#;].*)$/);
            if (comment) comments.push(comment[1]);
          }
        }
      const replacement = newEntry
        ? [
            `${key} = ${newEntry.value.split("\n")[0]}`,
            ...newEntry.value
              .split("\n")
              .slice(1)
              .map((value) => `    ${value}`),
          ]
        : [];
      const start = oldEntry?.start ?? section.end;
      // A final split sentinel must remain after any inserted option.
      const insertion =
        !oldEntry &&
        start === original.lines.length &&
        original.lines.at(-1) === ""
          ? start - 1
          : start;
      edits.push({
        start: insertion,
        end: oldEntry?.end ?? insertion,
        lines: [...comments, ...replacement],
      });
    }
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    original.lines.splice(edit.start, edit.end - edit.start, ...edit.lines);
  return original.lines.join(original.newline);
}
