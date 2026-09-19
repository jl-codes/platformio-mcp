/** Bounded serial framing and cursor/wait acceptance without physical devices. */
import { describe, it, expect } from "vitest";
import { SerialSessionBuffer } from "../src/core/serial/session-buffer.js";
const put = (buffer: SerialSessionBuffer, text: string) =>
  buffer.append(Buffer.from(text));

describe("serial session buffer", () => {
  it("frames split UTF-8, split CRLF, bare CR/LF and empty lines", () => {
    const buffer = new SerialSessionBuffer();
    const bytes = Buffer.from("A🙂B\r\nC\rD\n\n");
    for (const byte of bytes) buffer.append(Buffer.from([byte]));
    expect(buffer.snapshot()).toMatchObject({
      lines: ["A🙂B", "C", "D", ""],
      cursor: 4,
      partial: "",
      receivedBytes: bytes.length,
      cursorStatus: "current",
    });
  });
  it("keeps cursors monotonic across ring eviction and reports exactly the lost lines", () => {
    const buffer = new SerialSessionBuffer({ maxLines: 2 });
    put(buffer, "one\ntwo\nthree\n");
    expect(buffer.snapshot({ cursor: 0, maxLines: 1 })).toMatchObject({
      lines: ["two"],
      cursor: 2,
      latestCursor: 3,
      firstAvailableCursor: 1,
      moreAvailable: true,
      droppedLines: 1,
      cursorStatus: "stale",
      totalDroppedBytes: 3,
    });
    expect(buffer.snapshot({ cursor: 2 })).toMatchObject({
      lines: ["three"],
      cursor: 3,
      droppedLines: 0,
      cursorStatus: "current",
    });
    put(buffer, "four\n");
    expect(buffer.snapshot({ cursor: 3 })).toMatchObject({
      lines: ["four"],
      cursor: 4,
      totalDroppedLines: 2,
    });
  });
  it("counts partial storage in the byte budget and does not fabricate line breaks", () => {
    const buffer = new SerialSessionBuffer({
      maxLines: 8,
      maxBytes: 8,
      maxLineBytes: 8,
    });
    put(buffer, "abcd\nef\nghi");
    expect(buffer.snapshot()).toMatchObject({
      lines: ["ef"],
      partial: "ghi",
      partialCursor: 2,
      droppedLines: 1,
      totalDroppedBytes: 4,
    });
    put(buffer, "jklmnopq");
    expect(buffer.snapshot()).toMatchObject({
      lines: [],
      partial: "ghijklmn",
      partialTruncatedBytes: 3,
      cursor: 2,
      totalDroppedLines: 2,
      totalTruncatedBytes: 3,
    });
    put(buffer, "\nnext\n");
    expect(buffer.snapshot({ cursor: 2 })).toMatchObject({
      lines: ["next"],
      cursor: 4,
      droppedLines: 1,
      totalTruncatedBytes: 3,
    });
  });
  it("truncates an overlong line at code-point boundaries and resets truncation for the next line", () => {
    const buffer = new SerialSessionBuffer({ maxBytes: 32, maxLineBytes: 6 });
    put(buffer, "🙂éXYZ\nok\n");
    expect(buffer.snapshot()).toMatchObject({
      lines: ["🙂é", "ok"],
      lineTruncatedBytes: [3, 0],
      totalTruncatedBytes: 3,
    });
  });
  it("does not skip a partial line when the response byte budget is full", () => {
    const buffer = new SerialSessionBuffer({ maxLineBytes: 4 });
    put(buffer, "ab\ncd\nxy");
    const first = buffer.snapshot({ maxBytes: 4 });
    expect(first).toMatchObject({
      lines: ["ab", "cd"],
      partial: "",
      cursor: 2,
      moreAvailable: true,
    });
    expect(
      buffer.snapshot({ cursor: first.cursor, maxBytes: 4 }),
    ).toMatchObject({
      lines: [],
      partial: "xy",
      cursor: 2,
      moreAvailable: false,
    });
  });
  it("rejects invalid/future cursors and excessive allocations before ingesting bytes", async () => {
    const buffer = new SerialSessionBuffer();
    for (const cursor of [-1, 0.5, 1, NaN, Infinity])
      expect(() => buffer.snapshot({ cursor })).toThrow();
    expect(() => new SerialSessionBuffer({ maxLines: 10001 })).toThrow();
    expect(() => new SerialSessionBuffer({ maxBytes: 3 })).toThrow();
    expect(() => buffer.append(Buffer.alloc(1024 * 1024 + 1))).toThrow();
    expect(buffer.snapshot().receivedBytes).toBe(0);
    await expect(buffer.read({ timeoutMs: 120001 })).rejects.toMatchObject({
      code: "SERIAL_BUFFER_ARGUMENT_INVALID",
    });
  });
  it("returns an empty poll separately from an elapsed wait", async () => {
    const buffer = new SerialSessionBuffer();
    expect(await buffer.read()).toMatchObject({
      readStatus: "empty",
      state: "open",
      cursor: 0,
    });
    expect(await buffer.read({ timeoutMs: 15 })).toMatchObject({
      readStatus: "timeout",
      state: "open",
    });
  });
  it("wakes independent readers on arrival and preserves their separate cursors", async () => {
    const buffer = new SerialSessionBuffer();
    const first = buffer.read({ timeoutMs: 1000 });
    const second = buffer.read({ timeoutMs: 1000 });
    put(buffer, "ready\n");
    expect(await first).toMatchObject({
      lines: ["ready"],
      cursor: 1,
      readStatus: "ready",
    });
    expect(await second).toMatchObject({ lines: ["ready"], cursor: 1 });
    expect(buffer.snapshot({ cursor: 1 }).lines).toEqual([]);
  });
  it("cancels only the requesting reader and cleans up its waiter", async () => {
    const buffer = new SerialSessionBuffer();
    const controller = new AbortController();
    const cancelled = buffer.read({
      timeoutMs: 1000,
      signal: controller.signal,
    });
    const continuing = buffer.read({ timeoutMs: 1000 });
    controller.abort();
    expect((await cancelled).readStatus).toBe("cancelled");
    put(buffer, "still alive\n");
    expect((await continuing).lines).toEqual(["still alive"]);
    expect((await buffer.read({ signal: controller.signal })).readStatus).toBe(
      "cancelled",
    );
  });
  it.each(["stopped", "disconnected", "error"] as const)(
    "retains text and terminal %s state",
    async (state) => {
      const buffer = new SerialSessionBuffer();
      put(buffer, "last complete\ntail");
      buffer.close(state, state === "error" ? "transport failure" : undefined);
      expect(await buffer.read()).toMatchObject({
        lines: ["last complete"],
        partial: "tail",
        state,
        readStatus: "closed",
      });
      expect(put(buffer, "late")).toBe(false);
      buffer.close("stopped");
      expect(buffer.snapshot().state).toBe(state);
    },
  );
  it("flushes incomplete UTF-8 and wakes blocked readers on disconnect", async () => {
    const buffer = new SerialSessionBuffer();
    const pending = buffer.read({ timeoutMs: 1000 });
    buffer.append(Buffer.from([0xf0, 0x9f]));
    buffer.close("disconnected");
    expect(await pending).toMatchObject({
      partial: "\ufffd",
      receivedBytes: 2,
      state: "disconnected",
      readStatus: "closed",
    });
  });
  it("caps pending readers and releases all waiters on shutdown", async () => {
    const buffer = new SerialSessionBuffer();
    const pending = Array.from({ length: 32 }, () =>
      buffer.read({ timeoutMs: 1000 }),
    );
    await expect(buffer.read({ timeoutMs: 1000 })).rejects.toMatchObject({
      code: "SERIAL_READ_BUSY",
    });
    buffer.close();
    expect(
      (await Promise.all(pending)).every(
        (read) => read.readStatus === "closed",
      ),
    ).toBe(true);
  });
  it("keeps literal matching distinct from explicit bounded regex matching", async () => {
    const buffer = new SerialSessionBuffer();
    put(buffer, "acb\n");
    expect((await buffer.read({ waitFor: "a.b" })).matched).toBe(false);
    expect(
      await buffer.read({ waitFor: "a.b", patternOptions: { mode: "regex" } }),
    ).toMatchObject({ matched: true, readStatus: "matched" });
    await expect(
      buffer.read({ waitFor: "[", patternOptions: { mode: "regex" } }),
    ).rejects.toMatchObject({ code: "PATTERN_INVALID" });
  });
  it("matches a partial boot marker without committing it as a complete line", async () => {
    const buffer = new SerialSessionBuffer();
    const reading = buffer.read({ timeoutMs: 1000, waitFor: "boot ready" });
    put(buffer, "boot ready");
    expect(await reading).toMatchObject({
      lines: [],
      partial: "boot ready",
      cursor: 0,
      matched: true,
    });
  });
  it("returns a full page without consuming unseen lines while waiting for a pattern", async () => {
    const buffer = new SerialSessionBuffer();
    put(buffer, "one\ntwo\nmatch\n");
    expect(
      await buffer.read({ maxLines: 2, waitFor: "match", timeoutMs: 1000 }),
    ).toMatchObject({
      lines: ["one", "two"],
      cursor: 2,
      moreAvailable: true,
      matched: false,
      readStatus: "ready",
    });
    expect(await buffer.read({ cursor: 2, waitFor: "match" })).toMatchObject({
      lines: ["match"],
      matched: true,
    });
  });
  it("defers a partial after the maximum matcher page without losing it", async () => {
    const buffer = new SerialSessionBuffer({ maxLines: 10000 });
    put(buffer, "line\n".repeat(10000) + "marker");
    const first = await buffer.read({ maxLines: 10000, waitFor: "marker" });
    expect(first.lines).toHaveLength(10000);
    expect(first).toMatchObject({
      cursor: 10000,
      partial: "",
      moreAvailable: true,
      matched: false,
    });
    expect(
      await buffer.read({ cursor: first.cursor, waitFor: "marker" }),
    ).toMatchObject({
      partial: "marker",
      cursor: 10000,
      matched: true,
    });
  });
  it("refreshes terminal data arriving during an in-flight regex poll", async () => {
    const buffer = new SerialSessionBuffer();
    put(buffer, "before\n");
    const reading = buffer.read({
      waitFor: "missing",
      patternOptions: { mode: "regex" },
    });
    put(buffer, "after\ntail");
    buffer.close("disconnected");
    expect(await reading).toMatchObject({
      lines: ["before", "after"],
      partial: "tail",
      cursor: 2,
      state: "disconnected",
      readStatus: "closed",
      matched: false,
    });
  });
  it("reports later data when an earlier regex snapshot matches", async () => {
    const buffer = new SerialSessionBuffer();
    put(buffer, "match\n");
    const reading = buffer.read({
      waitFor: "match",
      patternOptions: { mode: "regex" },
    });
    put(buffer, "later\n");
    const first = await reading;
    expect(first).toMatchObject({
      lines: ["match"],
      cursor: 1,
      matched: true,
      moreAvailable: true,
    });
    expect(buffer.snapshot({ cursor: first.cursor }).lines).toEqual(["later"]);
  });
});

describe("redacted serial buffer", () => {
  it("tracks PEM delimiters beyond a truncated line and across chunks and eviction", () => {
    const buffer = new SerialSessionBuffer(
      { maxLines: 1, maxBytes: 40, maxLineBytes: 20 },
      true,
    );
    for (const character of "prefix too long -----BEGIN PRIVATE KEY-----\nsecret-body\n")
      put(buffer, character);
    expect(buffer.snapshot().lines).toEqual(["[REDACTED_SECRET]"]);
    put(buffer, "more-secret");
    expect(buffer.snapshot().partial).toBe("[REDACTED_SECRET]");
    put(buffer, "\n-----END PRIVATE KEY-----\nready\n");
    expect(buffer.snapshot().lines).toEqual(["ready"]);
  });
  it("redacts assignments in partial reads and bounds expanding replacement text", () => {
    const buffer = new SerialSessionBuffer(
      { maxBytes: 12, maxLineBytes: 12 },
      true,
    );
    put(buffer, "token=x");
    expect(buffer.snapshot()).toMatchObject({
      partial: "[REDACTED_SE",
      redactionApplied: true,
      redactionOutputMayBeTruncated: true,
    });
    put(buffer, "\n");
    expect(
      Buffer.byteLength(buffer.snapshot().lines.join("")),
    ).toBeLessThanOrEqual(12);
  });
});
