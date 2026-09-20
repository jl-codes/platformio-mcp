#pragma once
#include <AuditChild.h>
inline int audit_parent() { return audit_child() + 1; }
