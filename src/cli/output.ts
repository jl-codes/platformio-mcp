/**
 * CLI output formatting.
 * Pure presentation: no business logic, no process control beyond exit codes.
 */

export function printHuman(data: unknown): void {
  if (typeof data === "string") {
    console.log(data);
    return;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log("No results.");
      return;
    }
    for (const item of data) {
      console.log(JSON.stringify(item, null, 2));
    }
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

export function printOutput(data: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  printHuman(data);
}
