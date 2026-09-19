import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getSystemInfo } from "../../tools/projects.js";
import { findRunningPortal, startPortalServer } from "../../api/server.js";
import { asBoolean, parseNumberOption } from "../args.js";
import { PlatformIOError } from "../../utils/errors.js";
import type { CommandHandler } from "./types.js";

export const systemInfo: CommandHandler = async () => getSystemInfo();

/**
 * Without --serve this only reports status by reading the in-process
 * activePortalStatus singleton — it must NOT call getDashboardStatus /
 * getDashboardStatusCore, because that function unconditionally boots the
 * portal server as a side effect (its "on-demand boot" path in
 * src/api/server.ts) whenever activePortalStatus.running is false. That is
 * exactly the resident-process problem this task exists to close: the
 * dashboard is a long-lived HTTP server, so it starts only on explicit human
 * request via --serve. Agents/skills poll plain `dashboard` to check
 * whether one is already running, and must get a side-effect-free answer.
 */
export const dashboard: CommandHandler = async (ctx) => {
  if (!asBoolean(ctx.options.serve)) {
    // Cross-process: a one-shot CLI cannot see another process's
    // activePortalStatus, so reading that alone always answered "offline" and
    // the dashboard skill told users to start a second server.
    const portal = findRunningPortal();
    if (!portal) {
      return {
        status: "offline",
        running: false,
        message:
          "Dashboard is not running. Use `pio-agent dashboard --serve` to start it.",
      };
    }
    return {
      status: "online",
      running: true,
      pid: portal.pid,
      port: portal.port,
      baseUrl: `http://localhost:${portal.port}`,
    };
  }

  const port = parseNumberOption(ctx.options.port, "port") ?? 8080;
  const { httpServer } = startPortalServer(port);

  // Report the port the server is ACTUALLY on, once it is listening. Printing
  // synchronously advertised the requested port before `listen` resolved, so
  // on a busy port the user was told a URL that never worked while the server
  // retried onto the next one.
  httpServer.on("listening", () => {
    const addr = httpServer.address();
    const bound = addr && typeof addr === "object" ? addr.port : port;
    console.error(`[pio-agent] Dashboard running at http://localhost:${bound}`);
    console.error("[pio-agent] Press Ctrl+C to stop.");
  });

  // Block until the server closes (startPortalServer registers SIGINT/SIGTERM
  // handlers that close it and exit the process). A terminal bind failure --
  // the server gives up retrying -- must surface as an error, not a hang.
  await new Promise<void>((resolve, reject) => {
    httpServer.on("close", () => resolve());
    httpServer.on("error", (error: NodeJS.ErrnoException) => {
      // startPortalServer retries EADDRINUSE itself; anything else is final.
      if (error.code !== "EADDRINUSE") {
        reject(
          new PlatformIOError(
            `Dashboard could not start: ${error.code ?? error.message}`,
            "DASHBOARD_START_FAILED",
            { port, errno: error.code },
          ),
        );
      }
    });
  });
  return undefined;
};

async function runInstallSubcommand(rawArgs: string[]) {
  const target = rawArgs.find((a) => a.startsWith("--"))?.replace(/^--/, "");
  if (!target) {
    throw new Error("Usage: install --<cline|claude|vscode|antigravity|codex>");
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const installerEntry = path.join(
    currentDir,
    "..",
    "..",
    "..",
    "scripts",
    "installers",
    "index.js",
  );
  const installerUrl = pathToFileURL(installerEntry).href;
  const { runInstaller } = (await import(installerUrl)) as {
    runInstaller: (targetName: string) => Promise<void>;
  };
  await runInstaller(target);
}

export const install: CommandHandler = async (ctx) => {
  await runInstallSubcommand(ctx.rawArgs ?? []);
  if (!ctx.jsonMode) {
    console.log("Installer completed.");
  } else {
    console.log(JSON.stringify({ success: true }, null, 2));
  }
  return undefined;
};

export const plugin: CommandHandler = async (ctx) => {
  if (ctx.positionals[0] !== "validate" || ctx.positionals.length !== 1) {
    throw new Error("Usage: plugin validate [--require-runtime]");
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const validatorEntry = path.join(
    currentDir,
    "..",
    "..",
    "..",
    "scripts",
    "validate-codex-plugin.mjs",
  );
  const validatorUrl = pathToFileURL(validatorEntry).href;
  const { validateCodexPlugin } = (await import(validatorUrl)) as {
    validateCodexPlugin: (options?: { requireRuntime?: boolean }) => {
      skills: number;
      runtimePresent: boolean;
    };
  };
  const result = validateCodexPlugin({
    requireRuntime: asBoolean(ctx.options["require-runtime"]) ?? false,
  });
  return {
    success: true,
    ...result,
  };
};
