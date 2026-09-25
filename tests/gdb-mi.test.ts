/** Protocol fixtures run without launching a debugger or touching a probe. */
import { expect, it } from "vitest";
import { GdbMiFramer, parseGdbMiRecord } from "../src/core/debug/gdb-mi.js";

it("preserves exact tokens, nested frames and repeated result-list names", () => {
  const result = parseGdbMiRecord(
    '90071992547409931^done,stack=[frame={level="0",func="main"},frame={level="1",func="loop"}]',
  );
  expect(result).toEqual({
    kind: "result",
    token: "90071992547409931",
    class: "done",
    fields: [
      {
        name: "stack",
        value: {
          kind: "results",
          fields: [
            {
              name: "frame",
              value: {
                kind: "tuple",
                fields: [
                  { name: "level", value: "0" },
                  { name: "func", value: "main" },
                ],
              },
            },
            {
              name: "frame",
              value: {
                kind: "tuple",
                fields: [
                  { name: "level", value: "1" },
                  { name: "func", value: "loop" },
                ],
              },
            },
          ],
        },
      },
    ],
  });
});
it("distinguishes streams, events, notifications and prompts from results", () => {
  const framer = new GdbMiFramer();
  const records = framer.push(
    Buffer.from(
      '~"console\\n"\n*running,thread-id="all"\n=thread-created,id="1"\n+download,section=".text"\n7^running\n(gdb) \n',
    ),
  );
  expect(records.map((record) => record.kind)).toEqual([
    "stream",
    "exec",
    "notify",
    "status",
    "result",
    "prompt",
  ]);
  expect(records[4]).toMatchObject({ token: "7", class: "running" });
  expect(records[1]).not.toHaveProperty("token");
});
it("handles byte-fragmented UTF-8, octal bytes and CRLF boundaries", () => {
  const framer = new GdbMiFramer();
  const input = Buffer.from(
    '~"\u6e2c\u8a66 \\303\\251\\n"\r\n12^done,value="ok"\r\n(gdb)\r\n',
  );
  const records = [...input].flatMap((byte) =>
    framer.push(Buffer.from([byte])),
  );
  records.push(...framer.finish());
  expect(records).toEqual([
    { kind: "stream", channel: "console", text: "\u6e2c\u8a66 \u00e9\n" },
    {
      kind: "result",
      token: "12",
      class: "done",
      fields: [{ name: "value", value: "ok" }],
    },
    { kind: "prompt" },
  ]);
});
it("retains lists and debugger-controlled property names as data", () => {
  const result = parseGdbMiRecord(
    '^done,__proto__="literal",values=["a",{},[]]',
  );
  expect(result).toMatchObject({
    fields: [
      { name: "__proto__", value: "literal" },
      {
        name: "values",
        value: {
          kind: "list",
          values: [
            "a",
            { kind: "tuple", fields: [] },
            { kind: "list", values: [] },
          ],
        },
      },
    ],
  });
  expect(Object.prototype).not.toHaveProperty("literal");
});
it.each([
  '^done,value="unterminated',
  '^done,value={name="x"',
  '^done,value=["a",name="b"]',
  '^done,value="x",',
  '^done,value="x"garbage',
  '~"bad\\q"',
  '~"bad\\777"',
  '^done,value="x"\n2^done',
])("rejects malformed protocol %j", (line) => {
  expect(() => parseGdbMiRecord(line)).toThrow(
    expect.objectContaining({ code: "GDB_MI_INVALID" }),
  );
});
it("limits hostile nesting and unterminated records", () => {
  expect(() =>
    parseGdbMiRecord("^done,value=" + "[".repeat(35) + '"x"' + "]".repeat(35)),
  ).toThrow(expect.objectContaining({ code: "GDB_MI_LIMIT" }));
  const framer = new GdbMiFramer();
  expect(() =>
    framer.push(Buffer.from('~"' + "x".repeat(1024 * 1024))),
  ).toThrow(expect.objectContaining({ code: "GDB_MI_LIMIT" }));
});
it("retains diagnostics without mistaking them for command completion", () => {
  expect(parseGdbMiRecord("GNU gdb fixture")).toEqual({
    kind: "other",
    text: "GNU gdb fixture",
  });
  const framer = new GdbMiFramer();
  framer.push(Buffer.from("7^done"));
  expect(framer.finish()).toEqual([
    { kind: "result", token: "7", class: "done", fields: [] },
  ]);
  expect(() => framer.push(Buffer.from("8^done\n"))).toThrow("already ended");
});
