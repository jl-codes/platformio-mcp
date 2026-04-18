import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_PATH = path.resolve(__dirname, "../build/index.js");

export class MCPTestHarness {
  public client: Client;
  private transport: StdioClientTransport;

  constructor() {
    this.transport = new StdioClientTransport({
      command: process.execPath, // Path to node binary
      args: [SERVER_PATH],
      env: {
        ...process.env,
        PATH: `${process.env.PATH}:${process.env.HOME}/.platformio/penv/bin`,
      },
    });

    this.client = new Client(
      {
        name: "vitest-test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );
  }

  async connect() {
    await this.client.connect(this.transport);
  }

  async disconnect() {
    try {
      if (this.transport) {
        await this.client.close();
        await this.transport.close();
      }
    } catch (error) {
      console.warn("Error during transport disconnect:", error);
    }
  }
}
