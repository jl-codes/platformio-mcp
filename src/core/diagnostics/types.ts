export type DiagnosticStage =
  | "build"
  | "upload"
  | "monitor"
  | "test"
  | "device_discovery"
  | "unknown";

export type DiagnosticErrorType =
  | "MissingHeader"
  | "MissingLibrary"
  | "SyntaxError"
  | "LinkerError"
  | "MemoryOverflow"
  | "WrongBoard"
  | "WrongFramework"
  | "UnknownBoard"
  | "UnknownFramework"
  | "PortBusy"
  | "PermissionDenied"
  | "UploadSyncFailed"
  | "DeviceDisconnected"
  | "BootLoop"
  | "Brownout"
  | "WatchdogReset"
  | "PanicTrace"
  | "NoSerialOutput"
  | "Esp32StrappingPinRisk"
  | "Unknown";

export interface DiagnosticResult {
  success: boolean;
  stage: DiagnosticStage;
  errorType?: DiagnosticErrorType;
  severity: "info" | "warning" | "error" | "critical";
  summary: string;
  evidence: string[];
  recommendedAction: string;
  safeToAutoRetry: boolean;
  rawLogPath?: string;
  taskId?: string;
  timestamp: string;
}

export interface DiagnosticMatcher {
  errorType: DiagnosticErrorType;
  pattern: RegExp;
  recommendedAction: string;
  severity: DiagnosticResult["severity"];
  safeToAutoRetry: boolean;
}
