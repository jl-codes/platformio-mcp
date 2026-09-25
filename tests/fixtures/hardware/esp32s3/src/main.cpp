// Repository-owned physical acceptance fixture. UART0 uses the board defaults.
// No additional GPIO, radio, external peripheral, or power output is enabled.
#include <Arduino.h>
#include <cstdlib>
#include <cstring>

static char command[64];
static size_t commandLength = 0;
static bool commandOverflow = false;
static uint32_t lastHeartbeat = 0;

// A serial command deliberately triggers this source location for symbolication.
__attribute__((noinline)) void parity_fixture_crash() {
    Serial.println("PIO_HIL_READY_BEFORE_CRASH");
    Serial.flush();
    delay(2000);
    abort();
}

void setup() {
    Serial.begin(115200);
    Serial.println("PIO_HIL_READY");
}

void loop() {
    while (Serial.available()) {
        const char value = static_cast<char>(Serial.read());
        if (value == '\r') continue;
        if (value == '\n') {
            command[commandLength] = '\0';
            if (!commandOverflow) {
                if (strcmp(command, "CRASH") == 0) parity_fixture_crash();
                else { Serial.print("PIO_HIL_ECHO:"); Serial.println(command); }
            } else Serial.println("PIO_HIL_INPUT_TOO_LONG");
            commandLength = 0;
            commandOverflow = false;
        } else if (commandLength < sizeof(command) - 1) {
            command[commandLength++] = value;
        } else commandOverflow = true;
    }
    const uint32_t now = millis();
    if (now - lastHeartbeat >= 1000) {
        lastHeartbeat = now;
        Serial.println("PIO_HIL_HEALTHY");
    }
    delay(1);
}
