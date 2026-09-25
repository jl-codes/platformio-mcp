/** Private transient analysis storage; callers must stop all consumers before returning. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PlatformIOError } from "../../utils/errors.js";

const execute = promisify(execFile);
const WINDOWS_PRIVATE_ACL = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:PIO_PRIVATE_ANALYSIS_DIRECTORY
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
[System.IO.Directory]::SetAccessControl($target, $acl)
$actual = [System.IO.Directory]::GetAccessControl($target)
if (-not $actual.AreAccessRulesProtected) { throw 'Unprotected analysis directory' }
$rules = $actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl') { throw 'Unexpected analysis ACL' }
`;

/** Create an owner-only directory before writing sensitive bytes; fail closed if permissions cannot be set. */
export async function createPrivateAnalysisDirectory(
  parent = os.tmpdir(),
): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(parent, "pio-private-analysis-"),
  );
  try {
    try {
      if (process.platform === "win32") {
        const systemRoot = process.env.SystemRoot;
        if (!systemRoot || !path.isAbsolute(systemRoot))
          throw new Error("Windows system root unavailable");
        await execute(
          path.join(
            systemRoot,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
          ),
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(WINDOWS_PRIVATE_ACL, "utf16le").toString("base64"),
          ],
          {
            windowsHide: true,
            timeout: 15000,
            maxBuffer: 16384,
            env: { ...process.env, PIO_PRIVATE_ANALYSIS_DIRECTORY: directory },
          },
        );
      } else {
        await fs.chmod(directory, 0o700);
        const permissions = await fs.stat(directory);
        if (
          (permissions.mode & 0o777) !== 0o700 ||
          (process.getuid && permissions.uid !== process.getuid())
        )
          throw new Error("Unexpected analysis directory owner or permissions");
      }
    } catch {
      throw new PlatformIOError(
        "Cannot establish private analysis storage.",
        "ANALYSIS_PRIVATE_STORAGE_UNAVAILABLE",
      );
    }
    return directory;
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Keep sensitive files private for a callback and remove them after all consumers stop. */
export async function withPrivateAnalysisDirectory<T>(
  use: (directory: string) => Promise<T>,
  parent?: string, // Host-resolved staging parent, never an unchecked tool argument.
): Promise<T> {
  const directory = await createPrivateAnalysisDirectory(parent);
  try {
    return await use(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
