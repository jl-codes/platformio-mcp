#!/bin/bash
LOG_DIR="logs"
mkdir -p "$LOG_DIR"
LOCK_FILE="$LOG_DIR/.flash-lock"
MONITOR_PID="$LOG_DIR/device-monitor.pid"
HAS_BGMONITOR=false

# Check if background device-monitor.py is running
if [ -f "$MONITOR_PID" ] && kill -0 $(cat "$MONITOR_PID") 2>/dev/null; then
    HAS_BGMONITOR=true
    echo "[*] Background monitor detected. Pausing it for flash..."
    touch "$LOCK_FILE"
else
    echo "[*] No background monitor detected. Standalone flash mode."
fi

# Fallback/Safety: kill any remaining pio monitor processes directly
pgrep -f "pio device monitor" | xargs kill -9 2>/dev/null || true
pgrep -f "miniterm" | xargs kill -9 2>/dev/null || true

if pio device list | grep -q "Arduino Nano ESP32\|2341:0070\|303A:1001"; then
    echo "Detected Arduino Nano ESP32 (esp32s3nano)"
    ENV="esp32s3nano"
else
    echo "Detected ESP32 Dev Module (esp32dev)"
    ENV="esp32dev"
fi

TIMESTAMP=$(date +"%y%m%d-%H%M%S")
LOG_FILE="$LOG_DIR/device-monitor-$TIMESTAMP.log"
LATEST_LOG="$LOG_DIR/latest-monitor.log"
echo "Live link: $LATEST_LOG"

# Build and Upload
# We use PYTHONUNBUFFERED=1 and stdbuf (if available) to ensure tee and tail show updates immediately.
STDBUF_CMD=$(which stdbuf 2>/dev/null && echo "stdbuf -oL")
export PYTHONUNBUFFERED=1

$STDBUF_CMD pio run -e $ENV -t upload
UPLOAD_STATUS=$?

if [ "$UPLOAD_STATUS" -ne 0 ]; then
    echo "[!] Upload failed."
fi

# Resume logic
if [ "$HAS_BGMONITOR" = true ]; then
    echo "[*] Resuming background monitor..."
    rm -f "$LOCK_FILE"
    echo "[*] Flash workflow complete. Logs are streaming to your background terminal."
else
    echo "[*] Starting standalone monitor..."
    $STDBUF_CMD pio device monitor -e $ENV --raw | $STDBUF_CMD tee "$LOG_FILE" | $STDBUF_CMD tee "$LATEST_LOG"
fi
