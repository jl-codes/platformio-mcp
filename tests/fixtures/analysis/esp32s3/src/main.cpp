// Repository-owned symbolization fixture. Build only; no device is required.
#include <Arduino.h>

volatile unsigned int fixture_counter = 0;

__attribute__((noinline)) unsigned int fixture_add(unsigned int value) {
    return value + 7;
}

void setup() {
    fixture_counter = fixture_add(35);
}

void loop() {
    delay(1000);
}
