/** Windows USB discovery uses present Plug and Play device capabilities and physical location paths. */
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import { runAnalysisProcess } from "../analysis/analysis-process.js";
import { selectDebugProbe, type UsbProbeRecord } from "./debug-probe.js";

const inventoryScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Import-Module (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules\PnpDevice\PnpDevice.psd1')
$devices = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}\\[^\\]+$' })
if ($devices.Count -gt 1024) { throw 'USB inventory exceeds limits' }
$records = @($devices | ForEach-Object {
  $caps = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_Capabilities' -ErrorAction SilentlyContinue
  $locations = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_LocationPaths' -ErrorAction SilentlyContinue
  [pscustomobject]@{
    instanceId = $_.InstanceId
    capabilities = if ($null -ne $caps) { [uint32]$caps.Data } else { $null }
    location = if ($locations.Data.Count -gt 0) { [string]$locations.Data[0] } else { $null }
  }
})
ConvertTo-Json -InputObject $records -Compress -Depth 3
`;

/** Validate bounded helper output and require the USB driver's unique-ID capability before using its serial. */
export function parseWindowsUsbProbes(output: string) {
  const invalid = (): never => {
    throw new PlatformIOError(
      "Invalid Windows USB inventory.",
      "DEBUG_PROBE_INVENTORY_INVALID",
    );
  };
  if (Buffer.byteLength(output) > 1024 * 1024) return invalid();
  let records: unknown;
  try {
    records = JSON.parse(output);
  } catch {
    return invalid();
  }
  if (!Array.isArray(records) || records.length > 1024) return invalid();
  const devices: UsbProbeRecord[] = [];
  let unidentified = 0;
  for (const record of records) {
    if (
      !record ||
      typeof record !== "object" ||
      typeof record.instanceId !== "string" ||
      record.instanceId.length > 1024
    )
      return invalid();
    const match = /^USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})\\([^\\]+)$/i.exec(
      record.instanceId,
    );
    if (!match) continue;
    // CM_DEVCAP_UNIQUEID distinguishes device-provided serials from location-generated instance IDs.
    if (
      !Number.isInteger(record.capabilities) ||
      !(record.capabilities & 0x10) ||
      typeof record.location !== "string" ||
      !record.location
    ) {
      unidentified++;
      continue;
    }
    devices.push(
      selectDebugProbe([
        {
          vendorId: match[1],
          productId: match[2],
          serialNumber: match[3],
          location: record.location,
        },
      ]).probe,
    );
  }
  return { devices, unidentified, source: "windows_pnp" as const };
}

/** Read host metadata with a fixed native PowerShell command; public requests cannot replace the script. */
export async function enumerateWindowsUsbProbes() {
  const systemRoot = process.env.SystemRoot;
  if (
    process.platform !== "win32" ||
    !systemRoot ||
    !path.isAbsolute(systemRoot)
  )
    throw new PlatformIOError(
      "Windows USB discovery is unavailable.",
      "DEBUG_PROBE_PLATFORM_UNSUPPORTED",
    );
  const result = await runAnalysisProcess(
    path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(inventoryScript, "utf16le").toString("base64"),
    ],
    { timeoutMs: 30000, maxOutputBytes: 1024 * 1024 },
  );
  return parseWindowsUsbProbes(result.stdout);
}
