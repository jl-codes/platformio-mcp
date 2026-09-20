/** Numeric debugger endpoint identities are inert and consistent across equivalent spellings. */
import { expect, it } from "vitest";
import { parseRemoteDebugEndpoint } from "../src/core/debug/debug-remote-endpoint.js";
it("shares local endpoint identity with owned backend custody", () => {
  for (const input of [
    ":3333",
    "localhost:3333",
    "127.0.0.1:3333",
    "[::ffff:7f00:1]:3333",
  ])
    expect(parseRemoteDebugEndpoint(input)).toEqual({
      host: "127.0.0.1",
      port: 3333,
      resource: { kind: "network", identity: "debug-tcp:127.0.0.1:3333" },
    });
});
it("canonicalizes numeric IPv6 aliases without DNS", () => {
  expect(parseRemoteDebugEndpoint("[2001:0db8:0:0:0:0:0:1]:03333")).toEqual(
    parseRemoteDebugEndpoint("[2001:db8::1]:3333"),
  );
  expect(
    Object.isFrozen(parseRemoteDebugEndpoint("192.0.2.1:3333").resource),
  ).toBe(true);
});
it.each([
  null,
  "example.com:3333",
  "192.0.2.1:0",
  "192.0.2.1:65536",
  "tcp:192.0.2.1:3333",
  "| command",
  "192.0.2.1:3333\n",
  "0.0.0.0:3333",
  "224.0.0.1:3333",
  "[::]:3333",
  "[ff02::1]:3333",
  "[::ffff:e000:1]:3333",
  "[fe80::1%eth0]:3333",
])("rejects unresolved or invalid endpoint %s", (value) => {
  expect(() => parseRemoteDebugEndpoint(value)).toThrowError(
    expect.objectContaining({ code: "DEBUG_ENDPOINT_UNSUPPORTED" }),
  );
});
