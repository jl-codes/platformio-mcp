/**
 * Native Workspace Folder Picker
 *
 * Provides:
 * - pickWorkspaceDirectory: Opens the host folder picker independently of
 *   HTTP routing so headless tests can replace this boundary.
 */

import { execSync } from "node:child_process";

/** Error raised when the host has no supported graphical folder picker. */
export class WorkspacePickerUnavailableError extends Error {
  constructor() {
    super("Native folder picker is not available on this system.");
    this.name = "WorkspacePickerUnavailableError";
  }
}

/**
 * Opens the native directory chooser for the current operating system.
 *
 * @returns Selected path, or null when the user cancels.
 */
export function pickWorkspaceDirectory(): string | null {
  let result: string;
  if (process.platform === "darwin") {
    result = execSync("osascript -e 'POSIX path of (choose folder)'").toString();
  } else if (process.platform === "win32") {
    const script =
      "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; " +
      "$f = New-Object System.Windows.Forms.FolderBrowserDialog; " +
      "$f.Description = 'Select PlatformIO Project'; " +
      "$f.ShowNewFolderButton = $false; " +
      "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '' }";
    result = execSync(`powershell -NoProfile -Command "${script}"`, {
      timeout: 60_000,
    }).toString();
  } else {
    try {
      result = execSync(
        "zenity --file-selection --directory --title='Select PlatformIO Project'",
        { timeout: 60_000 },
      ).toString();
    } catch {
      throw new WorkspacePickerUnavailableError();
    }
  }
  return result.trim() || null;
}
