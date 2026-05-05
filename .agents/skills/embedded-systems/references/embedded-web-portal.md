# Embedded Web Portals

This reference provides the principles and constraints required when designing web interfaces, dashboards, or captive setup portals for memory-constrained embedded systems (like the ESP32).

## Design & Payloads

1. **Payload Targets (<100KB)**: Keep total frontend payloads minimal. Rely on Single Page Application (SPA) designs using vanilla HTML/JS/CSS rather than heavy rendering frameworks. 
   - **Why?** We compress (GZIP) and deploy them as `const uint8_t PROGMEM` arrays. Serving compressed assets directly from Flash memory minimizes RAM impact and avoids the latency spikes associated with `LittleFS` runtime reads.

2. **Captive Portal Environments**:
   - **No External CDNs**: Captive setups have zero exterior internet routing. You must rely solely on serialized, on-device assets.
   - **DNS Redirection**: Always implement a wildcard DNS server redirecting resolving requests (`*`) to the Access Point's gateway IP. This is required to reliably trigger the native captive portal pop-ups on iOS/Android.

## Architecture & Security

1. **Asynchronous Execution**:
   - Use `ESPAsyncWebServer` (or equivalent non-blocking paradigms).
   - **Why?** Legacy synchronous blocking logic pauses the core network and display loops, which starves the RTOS watchdogs and causes massive (20-30s) UI hangs.

2. **Resource Protection**:
   - **Network Pool (Sockets)**: Validate network configs (like multiple external API keys) sequentially. Parallel polling risks exhausting the ESP32's extremely limited socket pool.
   - **Heap Parsing**: Apply standard memory-optimization principles heavily to inbound `HTTP POST` parsing. Use bounded `ArduinoJson` buffers (`StaticJsonDocument` or capped `DynamicJsonDocument`) to prevent malicious or accidental heap exhaustion from large payloads.
   - **Power State**: AP Mode (Captive Portal) draws ~100-120mA continuously. Implement an inactivity timeout (e.g., 10 minutes) to automatically shut down the AP mode, reducing both the thermal/power load and the attack surface.
   - **Data Exposure**: Never expose credentials (Wi-Fi passwords, API keys) via plaintext `HTTP GET` routing.

## Testing Strategy

- **Local Testing Principle**: Flashing hardware to test UI changes is slow and prone to dead-ends. Always build a decoupled, local-machine test harness (node servers, DOM mocks, Playwright) to iterate cleanly on HTML/JS before starting C++ integration.
- For this repository, explicitly follow the rules laid out in `.agents/workflows/web-testing-strategy.md` when tasked with editing the web portal.
