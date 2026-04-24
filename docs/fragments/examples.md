## Examples

### Create and upload an ESP32 project

```typescript
// List ESP32 boards
await listBoards("esp32");

// Initialize project
await initProject({
  board: "esp32dev",
  framework: "arduino",
  projectDir: "/path/to/esp32-blink"
});

// Build
await buildProject("/path/to/esp32-blink");

// Upload firmware
await uploadFirmware("/path/to/esp32-blink");

// Monitor
await startMonitor();
```

### Search and install libraries

```typescript
const libraries = await searchLibraries("ArduinoJson", 10);

await installLibrary("ArduinoJson", {
  projectDir: "/path/to/my-project",
  version: "^6.21.0"
});
```
