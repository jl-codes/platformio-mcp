import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_PATH = path.resolve(__dirname, "../src/index.ts");

function resolveServerLaunch(): { command: string; args: string[] } {
  const configuredPath = process.env.PIO_MCP_TEST_SERVER_PATH;
  if (!configuredPath) {
    return {
      command: process.execPath,
      args: ["--import", "tsx", SERVER_PATH],
    };
  }
  return {
    command: process.execPath,
    args: [path.resolve(configuredPath)],
  };
}

export class MCPTestHarness {
  public client: Client;
  private transport: StdioClientTransport;

  constructor() {
    const launch = resolveServerLaunch();
    const homeDir =
      process.env.HOME ||
      process.env.USERPROFILE ||
      path.dirname(process.execPath);
    const platformioBin = path.join(homeDir, ".platformio", "penv", "bin");
    const mergedPath = [process.env.PATH || "", platformioBin]
      .filter((entry) => entry.length > 0)
      .join(path.delimiter);

    this.transport = new StdioClientTransport({
      command: launch.command,
      args: launch.args,
      env: {
        ...process.env,
        PATH: mergedPath,
      },
    });

    this.client = new Client(
      {
        name: "vitest-test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
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
