/**
 * Bounded GDB/MI record parsing with lossless ordered result fields.
 * Grammar: https://sourceware.org/gdb/current/onlinedocs/gdb.html/GDB_002fMI-Output-Syntax.html
 */
import { StringDecoder } from "node:string_decoder";
import { PlatformIOError } from "../../utils/errors.js";

/** Repeated names remain separate entries; debugger-controlled keys never become object properties. */
export interface GdbMiField {
  name: string;
  value: GdbMiValue;
}
/** MI tuples and lists retain their distinct grammar and field ordering. */
export type GdbMiValue =
  | string
  | { kind: "tuple"; fields: GdbMiField[] }
  | { kind: "list"; values: GdbMiValue[] }
  | { kind: "results"; fields: GdbMiField[] };
/** Result tokens are opaque decimal strings, not potentially rounded JavaScript numbers. */
export type GdbMiRecord =
  | { kind: "prompt" }
  | { kind: "stream"; channel: "console" | "target" | "log"; text: string }
  | {
      kind: "result" | "exec" | "status" | "notify";
      token?: string;
      class: string;
      fields: GdbMiField[];
    }
  | { kind: "other"; text: string };

const MAX_LINE_BYTES = 1024 * 1024;
const MAX_NODES = 10000;
const MAX_DEPTH = 32;

/** Parse one complete line; diagnostic/banner text is never mistaken for a command result. */
export function parseGdbMiRecord(line: string): GdbMiRecord {
  const invalid = (): never => {
    throw new PlatformIOError("Malformed GDB/MI record.", "GDB_MI_INVALID");
  };
  if (Buffer.byteLength(line) > MAX_LINE_BYTES)
    throw new PlatformIOError("GDB/MI record exceeds 1 MiB.", "GDB_MI_LIMIT");
  if (/[\r\n]/.test(line)) invalid();
  if (/^\(gdb\)[ \t]*$/.test(line)) return { kind: "prompt" };
  let at = 0,
    nodes = 0;
  const charge = () => {
    if (++nodes > MAX_NODES)
      throw new PlatformIOError("GDB/MI node limit exceeded.", "GDB_MI_LIMIT");
  };
  const string = (): string => {
    if (line[at++] !== '"') return invalid();
    const bytes: number[] = [];
    while (at < line.length) {
      const character = line[at++];
      if (character === '"') return Buffer.from(bytes).toString("utf8");
      if (character !== "\\") {
        if (character.charCodeAt(0) < 32) return invalid();
        const point = line.codePointAt(at - 1)!;
        const text = String.fromCodePoint(point);
        at += text.length - 1;
        bytes.push(...Buffer.from(text));
        continue;
      }
      const escape = line[at++];
      const simple: Record<string, number> = {
        a: 7,
        b: 8,
        f: 12,
        n: 10,
        r: 13,
        t: 9,
        v: 11,
        e: 27,
        "\\": 92,
        '"': 34,
        "'": 39,
        "?": 63,
      };
      if (Object.hasOwn(simple, escape)) bytes.push(simple[escape]);
      else if (escape && /[0-7]/.test(escape)) {
        let digits = escape;
        while (digits.length < 3 && /[0-7]/.test(line[at] ?? ""))
          digits += line[at++];
        const value = parseInt(digits, 8);
        if (value > 255) return invalid();
        bytes.push(value);
      } else if (escape === "x") {
        let digits = "";
        while (/[0-9a-f]/i.test(line[at] ?? "")) digits += line[at++];
        if (!digits || digits.length > 2) return invalid();
        bytes.push(parseInt(digits, 16));
      } else return invalid();
    }
    return invalid();
  };
  const identifier = (): string => {
    const match = /^[a-zA-Z_][a-zA-Z0-9_-]*/.exec(line.slice(at));
    if (!match) return invalid();
    at += match[0].length;
    return match[0];
  };
  const field = (depth: number): GdbMiField => {
    charge();
    const name = identifier();
    if (line[at++] !== "=") return invalid();
    return { name, value: value(depth) };
  };
  const fields = (end: string, depth: number): GdbMiField[] => {
    const result: GdbMiField[] = [];
    if (line[at] === end) {
      at++;
      return result;
    }
    while (at < line.length) {
      result.push(field(depth));
      if (line[at] === end) {
        at++;
        return result;
      }
      if (line[at++] !== ",") return invalid();
    }
    return invalid();
  };
  const value = (depth: number): GdbMiValue => {
    charge();
    if (depth > MAX_DEPTH)
      throw new PlatformIOError(
        "GDB/MI nesting limit exceeded.",
        "GDB_MI_LIMIT",
      );
    if (line[at] === '"') return string();
    if (line[at] === "{") {
      at++;
      return { kind: "tuple", fields: fields("}", depth + 1) };
    }
    if (line[at++] !== "[") return invalid();
    if (line[at] === "]") {
      at++;
      return { kind: "list", values: [] };
    }
    if (/^[a-zA-Z_][a-zA-Z0-9_-]*=/.test(line.slice(at)))
      return { kind: "results", fields: fields("]", depth + 1) };
    const values: GdbMiValue[] = [];
    while (at < line.length) {
      values.push(value(depth + 1));
      if (line[at] === "]") {
        at++;
        return { kind: "list", values };
      }
      if (line[at++] !== ",") return invalid();
    }
    return invalid();
  };
  if ("~@&".includes(line[0] ?? "") && line.length) {
    const channel =
      line[at++] === "~" ? "console" : line[0] === "@" ? "target" : "log";
    const text = string();
    if (at !== line.length) invalid();
    return { kind: "stream", channel, text };
  }
  const prefix = /^([0-9]*)([\^*+=])/.exec(line);
  if (!prefix) return { kind: "other", text: line };
  if (prefix[1].length > 32)
    throw new PlatformIOError("GDB/MI token exceeds limits.", "GDB_MI_LIMIT");
  at = prefix[0].length;
  const resultClass = identifier();
  const result: GdbMiField[] = [];
  while (at < line.length) {
    if (line[at++] !== ",") invalid();
    result.push(field(0));
  }
  const kind =
    prefix[2] === "^"
      ? "result"
      : prefix[2] === "*"
        ? "exec"
        : prefix[2] === "+"
          ? "status"
          : "notify";
  return {
    kind,
    ...(prefix[1] ? { token: prefix[1] } : {}),
    class: resultClass,
    fields: result,
  };
}

/** Frame fragmented UTF-8 pipes without treating prompts or async notifications as command completion. */
export class GdbMiFramer {
  private decoder = new StringDecoder("utf8");
  private pending = "";
  private afterCr = false;
  private ended = false;

  /** Consume a bounded pipe chunk, retaining only the incomplete last record. */
  push(chunk: Uint8Array): GdbMiRecord[] {
    if (this.ended)
      throw new PlatformIOError(
        "GDB/MI stream already ended.",
        "GDB_MI_CLOSED",
      );
    if (chunk.byteLength > 8 * 1024 * 1024)
      throw new PlatformIOError("GDB/MI chunk exceeds limits.", "GDB_MI_LIMIT");
    return this.frame(this.decoder.write(Buffer.from(chunk)));
  }

  /** Flush the last complete record at EOF; malformed partial records remain errors. */
  finish(): GdbMiRecord[] {
    if (this.ended)
      throw new PlatformIOError(
        "GDB/MI stream already ended.",
        "GDB_MI_CLOSED",
      );
    this.ended = true;
    const records = this.frame(this.decoder.end());
    if (this.pending) records.push(parseGdbMiRecord(this.pending));
    this.pending = "";
    return records;
  }

  private frame(text: string): GdbMiRecord[] {
    const records: GdbMiRecord[] = [];
    let start = 0;
    for (let index = 0; index < text.length; index++) {
      const current = text[index];
      if (current !== "\r" && current !== "\n") continue;
      const part = this.pending + text.slice(start, index);
      this.pending = "";
      if (!(this.afterCr && current === "\n" && part === "")) {
        if (records.length >= 4096)
          throw new PlatformIOError(
            "Too many GDB/MI records in one chunk.",
            "GDB_MI_LIMIT",
          );
        records.push(parseGdbMiRecord(part));
      }
      this.afterCr = current === "\r";
      start = index + 1;
    }
    this.pending += text.slice(start);
    if (start < text.length) this.afterCr = false;
    if (Buffer.byteLength(this.pending) > MAX_LINE_BYTES)
      throw new PlatformIOError(
        "Incomplete GDB/MI record exceeds limits.",
        "GDB_MI_LIMIT",
      );
    return records;
  }
}
