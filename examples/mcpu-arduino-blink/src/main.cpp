#include <Arduino.h>

// Placeholder firmware template for MCP-U integration workflows.
// Replace this loop logic once MCP-U runtime commands are wired in your stack.
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
  Serial.println("MCPU_TEMPLATE_BOOT");
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(300);
  digitalWrite(LED_BUILTIN, LOW);
  delay(300);
}
