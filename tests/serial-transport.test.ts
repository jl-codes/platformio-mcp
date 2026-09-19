/** Direct serial lifecycle acceptance using the official mock binding and controlled failure callbacks. */
import { EventEmitter } from "node:events";
import { SerialPortMock } from "serialport";
import { describe, expect, it } from "vitest";
import {
  DirectSerialTransport,
  createDirectSerialTransport,
  type SerialPortHandle,
} from "../src/core/serial/serial-transport.js";
import { SerialSessionBuffer } from "../src/core/serial/session-buffer.js";

const options = { path: "COM_TEST", baudRate: 115200, operationTimeoutMs: 30 };
class ControlledPort extends EventEmitter implements SerialPortHandle {
  isOpen = false;
  closing = false;
  openCallback?: (error: Error | null) => void;
  closeCallback?: (error: Error | null) => void;
  writeCallback?: (error?: Error | null) => void;
  drainCallback?: (error?: Error | null) => void;
  sent?: Buffer;
  closes = 0;
  open(callback: (error: Error | null) => void): void {
    this.openCallback = callback;
  }
  close(callback: (error: Error | null) => void): void {
    this.closes++;
    this.closeCallback = callback;
  }
  write(bytes: Buffer, callback: (error?: Error | null) => void): boolean {
    this.sent = bytes;
    this.writeCallback = callback;
    return false;
  }
  drain(callback: (error?: Error | null) => void): void {
    this.drainCallback = callback;
  }
  opened(): void {
    this.isOpen = true;
    this.openCallback!(null);
  }
  closed(): void {
    this.closing = false;
    this.isOpen = false;
    this.emit("close");
    this.closeCallback?.(null);
  }
}
const openControlled = async () => {
  const port = new ControlledPort();
  const transport = new DirectSerialTransport(port, options, () => {});
  const opening = transport.open();
  port.opened();
  await opening;
  return { port, transport };
};

describe("direct serial transport", () => {
  it("frames echoed split UTF-8 through the actual maintained stream and official mock binding", async () => {
    const path = "SERIAL_TRANSPORT_MOCK";
    SerialPortMock.binding.createPort(path, {
      echo: true,
      record: true,
      maxReadSize: 1,
    });
    const port = new SerialPortMock({
      path,
      baudRate: 115200,
      autoOpen: false,
    });
    const buffer = new SerialSessionBuffer();
    const transport = new DirectSerialTransport(
      port,
      { path, baudRate: 115200 },
      (bytes) => buffer.append(bytes),
    );
    expect(port.isOpen).toBe(false);
    await transport.open();
    const reading = buffer.read({ waitFor: "hello 🙂", timeoutMs: 1000 });
    const bytes = Buffer.from("hello 🙂\r\n");
    expect(await transport.write(bytes)).toEqual({
      bytesWritten: bytes.length,
      drained: true,
    });
    expect((await reading).matched).toBe(true);
    expect(port.port!.recording).toEqual(bytes);
    await transport.close();
    await transport.confirmedClosed;
    expect(transport.state).toBe("stopped");
    expect(port.isOpen).toBe(false);
  });
  it("loads the pinned native backend without opening a physical device", async () => {
    const transport = await createDirectSerialTransport(
      { path: "COM_TEST_NEVER_OPENED", baudRate: 115200 },
      () => {},
    );
    expect(transport.state).toBe("idle");
    await transport.close();
    await transport.confirmedClosed;
  });
  it("requires drain completion, copies write input and rejects overlapping writes", async () => {
    const { port, transport } = await openControlled();
    const bytes = Buffer.from("original");
    const writing = transport.write(bytes);
    bytes.fill(0);
    expect(port.sent!.toString()).toBe("original");
    await expect(transport.write(Buffer.from("other"))).rejects.toMatchObject({
      code: "SERIAL_WRITE_BUSY",
    });
    let finished = false;
    void writing.then(() => {
      finished = true;
    });
    port.writeCallback!();
    await Promise.resolve();
    expect(finished).toBe(false);
    port.drainCallback!();
    expect(await writing).toEqual({ bytesWritten: 8, drained: true });
    const closing = transport.close();
    port.closed();
    await closing;
  });
  it("closes a late successful open after its timeout and keeps closure unconfirmed until then", async () => {
    const port = new ControlledPort();
    const transport = new DirectSerialTransport(port, options, () => {});
    let confirmed = false;
    void transport.confirmedClosed.then(() => {
      confirmed = true;
    });
    await expect(transport.open()).rejects.toMatchObject({
      code: "SERIAL_OPEN_TIMEOUT",
    });
    expect(transport.state).toBe("error");
    expect(confirmed).toBe(false);
    expect(port.closes).toBe(0);
    port.opened();
    expect(port.closes).toBe(1);
    expect(confirmed).toBe(false);
    port.closed();
    await transport.confirmedClosed;
    expect(confirmed).toBe(true);
    await expect(transport.write(Buffer.from("late"))).rejects.toMatchObject({
      code: "SERIAL_CLOSED",
    });
  });
  it("stops an in-flight open and closes rather than accepting its later completion", async () => {
    const port = new ControlledPort();
    const transport = new DirectSerialTransport(port, options, () => {});
    const opened = expect(transport.open()).rejects.toMatchObject({
      code: "SERIAL_CLOSED",
    });
    const closing = transport.close();
    await opened;
    port.opened();
    port.closed();
    await closing;
    expect(transport.state).toBe("stopped");
  });
  it("does not confirm a failed close and supports an explicit cleanup retry", async () => {
    const { port, transport } = await openControlled();
    const closing = transport.close();
    port.closeCallback!(new Error("driver failed"));
    let confirmed = false;
    void transport.confirmedClosed.then(() => {
      confirmed = true;
    });
    await expect(closing).rejects.toMatchObject({
      code: "SERIAL_CLOSE_TIMEOUT",
    });
    expect(confirmed).toBe(false);
    expect(port.isOpen).toBe(true);
    const retry = transport.close();
    port.closed();
    await retry;
    expect(confirmed).toBe(true);
  });
  it("fails writes on disconnect without retrying or accepting more data", async () => {
    const { port, transport } = await openControlled();
    const writing = expect(
      transport.write(Buffer.from("command")),
    ).rejects.toMatchObject({ code: "SERIAL_CLOSED" });
    port.closed();
    await writing;
    await transport.confirmedClosed;
    expect(transport.state).toBe("disconnected");
    await expect(transport.open()).rejects.toMatchObject({
      code: "SERIAL_TRANSPORT_STATE_INVALID",
    });
  });
  it("bounds writes and treats a stalled drain as partial failure until physical close", async () => {
    const { port, transport } = await openControlled();
    await expect(transport.write(Buffer.alloc(65537))).rejects.toMatchObject({
      code: "SERIAL_WRITE_LIMIT",
    });
    const writing = transport.write(Buffer.from("command"));
    port.writeCallback!();
    await expect(writing).rejects.toMatchObject({
      code: "SERIAL_WRITE_TIMEOUT",
    });
    expect(transport.state).toBe("error");
    expect(port.closes).toBe(1);
    port.closed();
    await transport.confirmedClosed;
  });
  it("handles open errors and consumer errors without leaking an unhandled event", async () => {
    const failedPort = new ControlledPort();
    const failed = new DirectSerialTransport(failedPort, options, () => {});
    const opening = expect(failed.open()).rejects.toMatchObject({
      code: "SERIAL_OPEN_FAILED",
    });
    failedPort.openCallback!(new Error("no port"));
    await opening;
    await failed.confirmedClosed;
    const port = new ControlledPort();
    const transport = new DirectSerialTransport(port, options, () => {
      throw new Error("consumer");
    });
    const opened = transport.open();
    port.opened();
    await opened;
    port.emit("data", Buffer.from("data"));
    expect(transport.state).toBe("error");
    port.closed();
    await transport.confirmedClosed;
    port.emit("error", new Error("late event"));
  });
  it("validates before loading/opening and bounds data callback chunks", async () => {
    await expect(
      createDirectSerialTransport(
        { path: "bad\npath", baudRate: 115200 },
        () => {},
      ),
    ).rejects.toMatchObject({ code: "SERIAL_TRANSPORT_ARGUMENT_INVALID" });
    const chunks: number[] = [];
    const port = new ControlledPort();
    const transport = new DirectSerialTransport(port, options, (bytes) =>
      chunks.push(bytes.length),
    );
    const opened = transport.open();
    port.opened();
    await opened;
    port.emit("data", Buffer.alloc(131073));
    expect(chunks).toEqual([65536, 65536, 1]);
    const closing = transport.close();
    port.closed();
    await closing;
  });
  it("joins concurrent cleanup calls without dispatching duplicate native closes", async () => {
    const { port, transport } = await openControlled();
    const closing = Array.from({ length: 50 }, () => transport.close());
    expect(port.closes).toBe(1);
    port.closed();
    await Promise.all(closing);
    await transport.confirmedClosed;
  });
  it("does not confuse the stream's closing-time isOpen=false with confirmed native closure", async () => {
    const { port, transport } = await openControlled();
    let confirmed = false;
    void transport.confirmedClosed.then(() => {
      confirmed = true;
    });
    port.closing = true;
    port.isOpen = false;
    port.emit("error", new Error("disconnect during native close"));
    await Promise.resolve();
    expect(confirmed).toBe(false);
    expect(port.closes).toBe(0);
    port.closed();
    await transport.confirmedClosed;
    expect(confirmed).toBe(true);
  });
});
