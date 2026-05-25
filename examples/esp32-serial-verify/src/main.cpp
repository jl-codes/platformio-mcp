#include <Arduino.h>

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("BOOT_OK");
}

void loop() {
  Serial.println("HEARTBEAT");
  delay(1000);
}
