// Build-only dependency graph acceptance fixture.
#include <Arduino.h>
#include <AuditParent.h>
volatile int audit_result;
void setup() { audit_result = audit_parent(); }
void loop() { delay(1000); }
