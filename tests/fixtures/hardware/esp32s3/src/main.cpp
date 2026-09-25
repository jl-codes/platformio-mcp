// Repository-owned physical acceptance fixture. UART0 uses the board defaults.
// No additional GPIO, radio, external peripheral, or power output is enabled.
#include <Arduino.h>
#include <cstdlib>
#include <cstring>
#ifdef PIO_HIL_OTA_ACCEPTANCE
#include <WiFi.h>
#include <ArduinoOTA.h>
#include <SPIFFS.h>
// Operator-only input is ignored by Git and never emitted through serial.
#include "../.pio-mcp-workspace/ota-private/config.h"
static bool otaStarted = false;

static void printOtaIdentity() {
    Serial.printf("PIO_HIL_OTA_ID mac=%s ip=%s port=3232 firmware=%s\n",
        WiFi.macAddress().c_str(), WiFi.localIP().toString().c_str(), PIO_HIL_FIRMWARE_LABEL);
}

static void pollOta() {
    if (WiFi.status() != WL_CONNECTED) return;
    if (!otaStarted) {
        ArduinoOTA.setHostname("pio-hil-esp32s3");
        ArduinoOTA.setPort(3232);
        ArduinoOTA.setPasswordHash(PIO_HIL_OTA_PASSWORD_HASH);
        ArduinoOTA.onStart([]() {
            if (ArduinoOTA.getCommand() == U_SPIFFS) SPIFFS.end();
            Serial.println("PIO_HIL_OTA_START");
        });
        ArduinoOTA.onEnd([]() { Serial.println("PIO_HIL_OTA_END"); });
        ArduinoOTA.onError([](ota_error_t error) { Serial.printf("PIO_HIL_OTA_ERROR=%u\n", error); });
        ArduinoOTA.begin();
        otaStarted = true;
        printOtaIdentity();
    }
    ArduinoOTA.handle();
}

static void verifyFilesystem() {
    if (!SPIFFS.begin(false)) { Serial.println("PIO_HIL_FS_MOUNT_FAILED"); return; }
    File file = SPIFFS.open("/parity.txt", "r");
    if (!file) { Serial.println("PIO_HIL_FS_MISSING"); return; }
    char marker[96] = {};
    file.readBytes(marker, sizeof(marker) - 1);
    file.close();
    Serial.print("PIO_HIL_FS:");
    Serial.println(marker);
}
#endif

// Native flash verification requires a quiet window after bounded health telemetry.
#ifndef PIO_HIL_HEARTBEAT_UNTIL_MS
#define PIO_HIL_HEARTBEAT_UNTIL_MS 0
#endif

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
#ifdef PIO_HIL_OTA_ACCEPTANCE
    WiFi.mode(WIFI_STA);
    WiFi.begin(PIO_HIL_WIFI_SSID, PIO_HIL_WIFI_PASSWORD);
#endif
}

void loop() {
#ifdef PIO_HIL_OTA_ACCEPTANCE
    pollOta();
#endif
    while (Serial.available()) {
        const char value = static_cast<char>(Serial.read());
        if (value == '\r') continue;
        if (value == '\n') {
            command[commandLength] = '\0';
            if (!commandOverflow) {
                if (strcmp(command, "CRASH") == 0) parity_fixture_crash();
#ifdef PIO_HIL_OTA_ACCEPTANCE
                else if (strcmp(command, "OTA_ID") == 0) printOtaIdentity();
                else if (strcmp(command, "FSVERIFY") == 0) verifyFilesystem();
#endif
                else { Serial.print("PIO_HIL_ECHO:"); Serial.println(command); }
            } else Serial.println("PIO_HIL_INPUT_TOO_LONG");
            commandLength = 0;
            commandOverflow = false;
        } else if (commandLength < sizeof(command) - 1) {
            command[commandLength++] = value;
        } else commandOverflow = true;
    }
    const uint32_t now = millis();
    if (now - lastHeartbeat >= 1000 &&
        (PIO_HIL_HEARTBEAT_UNTIL_MS == 0 || now <= PIO_HIL_HEARTBEAT_UNTIL_MS)) {
        lastHeartbeat = now;
        Serial.println("PIO_HIL_HEALTHY");
    }
    delay(1);
}
