/** Connection lifecycle checks without native transport or PlatformIO execution. */
import { expect, it, vi } from "vitest";
import { SerialClientContext } from "../src/adapters/serial-client.js";
import type { PolicySerialSessionService } from "../src/core/serial/session-policy.js";
it("coalesces disconnect cleanup and rejects requests once closed", async () => {
  const owner = Object.freeze({ id: "owned" });
  let finish!: (value: never[]) => void;
  const disconnect = vi.fn(
    () =>
      new Promise<never[]>((resolve) => {
        finish = resolve;
      }),
  );
  const service = {
    sessions: { createOwner: () => owner, disconnectOwner: disconnect },
    run: async (_context: unknown, execute: () => Promise<unknown>) =>
      execute(),
  } as unknown as PolicySerialSessionService;
  const client = new SerialClientContext(service);
  expect(await client.run({}, async (_service, principal) => principal)).toBe(
    owner,
  );
  const first = client.close();
  const second = client.close();
  expect(first).toBe(second);
  expect(disconnect).toHaveBeenCalledWith(owner);
  await expect(client.run({}, async () => true)).rejects.toMatchObject({
    code: "SERIAL_CLOSED",
  });
  finish([]);
  await first;
  const retry = client.close();
  expect(disconnect).toHaveBeenCalledTimes(2);
  finish([]);
  await retry;
});
it("does not deliver an in-flight result after disconnect", async () => {
  let deliver!: (value: string) => void;
  const service = {
    sessions: {
      createOwner: () => ({ id: "owned" }),
      disconnectOwner: async () => [],
    },
    run: async (_context: unknown, execute: () => Promise<unknown>) =>
      execute(),
  } as unknown as PolicySerialSessionService;
  const client = new SerialClientContext(service);
  const result = client.run(
    {},
    () =>
      new Promise<string>((resolve) => {
        deliver = resolve;
      }),
  );
  await client.close();
  deliver("private result");
  await expect(result).rejects.toMatchObject({ code: "SERIAL_CLOSED" });
});
