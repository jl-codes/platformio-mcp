# Planning Phase Resource Impact Assessment

Whenever drafting an implementation plan for an embedded project (specifically ESP32 or similar resource-constrained devices), you **MUST** include a "Resource Impact Assessment" section that rigorously evaluates the proposed changes against Memory, Power, and Security constraints.

This structured methodology ensures stability, longevity, and security are considered *before* code is written.

## Assessment Criteria

### 1. Memory Impact Assessment

#### Flash / Program Memory (ROM)
- **Estimate Increase:** How many bytes/KB will the binary size increase?
- **Optimization:** Are large data structures (lookup tables, fonts, bitmaps) marked as `const` to ensure they reside in Flash rather than RAM?
- **Impact:** Will this push the binary closer to partition limits?

#### Static RAM (DRAM / IRAM)
- **Global/Static Variables:** Have any new global or static variables been introduced?
- **BSS/Data Sections:** What is the impact on the constant memory footprint?

#### Stack Usage
- **Local Buffers:** Are there any large local arrays (e.g., `char buf[1024]`) that could risk a stack overflow (FreeRTOS tasks typically have small stacks, e.g., 4KB-8KB)?
- **Network Clients:** Identify "stack killers" like `WiFiClientSecure`, `WiFiClient`, or `HTTPClient`. These should NEVER be allocated on the stack in deep nested calls.
  - *Mitigation Pattern (ESP32):* Offload heavy objects to the heap using smart pointers: `std::unique_ptr<WiFiClientSecure> client(new (std::nothrow) WiFiClientSecure());`
- **Call Depth & Recursion:** Note if the change deepens the call stack significantly or introduces unbounded recursion.

#### Heap Usage & Fragmentation
- **Allocation Pattern:** Does the change use `new`, `malloc`, or dynamic containers (`std::vector`, `String`, `std::string`)?
- **Fragmentation Risk:** Frequent small allocations/deallocations of varying sizes lead to fragmentation. Can these be consolidated into a single larger allocation, made static, or reserved upfront (e.g., `vector.reserve()`)?
- **PSRAM:** If the change involves large buffers (e.g., framebuffers, network buffers), can they be explicitly allocated in PSRAM using `MALLOC_CAP_SPIRAM` (if available on the dev board)?
- **Stability:** Is every allocation matched with a deletion in *all* execution paths (including error handling)?

### 2. Power Impact Assessment

#### Sleep Modes & Duty Cycling
- **Wake Time:** Will this change increase the amount of time the device spends in an active state (modem-sleep vs. light-sleep vs. deep-sleep)?
- **Peripheral Usage:** Does the feature power on new peripherals (ADC, I2C, SPI) or radios (WiFi/BLE) that could otherwise be disabled?

#### Network & I/O Activity
- **Transmission Frequency:** Does the change increase the frequency or duration of network transmissions (the most power-hungry operation)?
- **Polling vs. Interrupts:** Does the feature rely on busy-waiting/polling instead of hardware interrupts or event-driven wakeups?

### 3. Security Impact Assessment

#### Attack Surface & Input Validation
- **New Interfaces:** Does the feature open new network ports, BLE characteristics, or physical interfaces (UART) that could be exploited?
- **Untrusted Input:** Are all new inputs rigorously bounds-checked and validated before processing (to guard against buffer overflows or injection)?

#### Cryptography & Credentials
- **Storage:** If handling keys, tokens, or passwords, are they stored securely (e.g., encrypted NVM, secure element) rather than plaintext?
- **Transport:** Is data transmitted securely (TLS/mTLS) using validated certificates?

---

## Example Assessment Section Template

Append this exact structure to your implementation plans:

```markdown
## Resource Impact Assessment

### Memory Impact
- **Flash/ROM:** Estimated increase of ~[X] bytes. [Any const optimizations made].
- **Static RAM:** [Impact on globals/statics].
- **Stack:** [Assessment of local buffers and call depth. Note any offloading of large objects].
- **Heap & Fragmentation:** [Assessment of dynamic allocations, PSRAM utilization, and fragmentation risk. Note any `.reserve()` usage].

### Power Impact
- **Sleep/Active Profile:** [How this affects the device's ability to sleep].
- **Radio/Peripheral Activity:** [Impact of WiFi/BLE or peripheral usage].

### Security Impact
- **Attack Surface:** [Assessment of newly exposed interfaces or parsers].
- **Data Protection:** [How credentials or sensitive data are handled securely].
```
