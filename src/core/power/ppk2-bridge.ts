/** Fixed isolated PPK2 bridge: explicit modes, bounded sampling and reported cleanup outcomes. */
export const PPK2_BRIDGE = String.raw`
import contextlib, json, math, os, sys, threading, time

def validate(request):
    if not isinstance(request, dict) or set(request) != {"port", "mode", "voltageMv", "currentLimitMa", "seconds"}:
        raise ValueError("PPK2_REQUEST_INVALID")
    if not isinstance(request["port"], str) or not 1 <= len(request["port"]) <= 512 or any(ord(c) < 32 or ord(c) == 127 for c in request["port"]):
        raise ValueError("PPK2_REQUEST_INVALID")
    if request["mode"] not in ("ampere", "source"):
        raise ValueError("PPK2_MODE_REQUIRED")
    for key in ("voltageMv", "currentLimitMa", "seconds"):
        if isinstance(request[key], bool) or not isinstance(request[key], (int, float)) or not math.isfinite(request[key]):
            raise ValueError("PPK2_REQUEST_INVALID")
    if not 800 <= request["voltageMv"] <= 5000 or int(request["voltageMv"]) != request["voltageMv"]:
        raise ValueError("PPK2_VOLTAGE_INVALID")
    maximum = 600 if request["mode"] == "source" else 1000
    if not 0 < request["currentLimitMa"] <= maximum or not 0 < request["seconds"] <= 600:
        raise ValueError("PPK2_LIMIT_INVALID")
    return request

def collect(request, factory, cancelled, emit):
    request = validate(request)
    meter = None
    outcome = "complete"
    measuring_attempted = False
    power_may_be_on = False
    stopped = False
    off_written = request["mode"] != "source"
    serial_closed = False
    count = 0
    pending = []
    emitted_windows = 0
    total = 0.0
    in_window = 0
    started = None
    raw_bytes = 0
    byte_carry = b""
    collection_finished = None
    sample_limit = math.ceil(request["seconds"] * 100000) + 100000
    try:
        if cancelled.is_set(): raise RuntimeError("PPK2_CANCELLED")
        # Retain partially initialized objects so failure cleanup can inspect/close their port.
        meter = factory.__new__(factory)
        factory.__init__(meter, request["port"], timeout=0.2, write_timeout=0.5)
        original_write = meter.ser.write
        def checked_write(data):
            written = original_write(data)
            if written != len(data): raise RuntimeError("PPK2_SHORT_WRITE")
            return written
        meter.ser.write = checked_write
        if request["mode"] == "source":
            # OFF precedes configuration and ON; even a failing ON write requires cleanup.
            meter.toggle_DUT_power("OFF")
            meter.ser.flush()
            off_written = True
        meter.get_modifiers()
        if request["mode"] == "source":
            meter.use_source_meter()
            meter.set_source_voltage(int(request["voltageMv"]))
        else:
            meter.use_ampere_meter()
            # Calibration input only: never call the source-voltage setter in ampere mode.
            meter.current_vdd = request["voltageMv"]
        if cancelled.is_set(): raise RuntimeError("PPK2_CANCELLED")
        if request["mode"] == "source":
            power_may_be_on = True
            off_written = False
            meter.toggle_DUT_power("ON")
        measuring_attempted = True
        meter.start_measuring()
        started = time.monotonic()
        last_data = started
        emit({"event": "started", "mode": request["mode"], "sampleRateHz": 100000, "windowSamples": 1000, "currentLimitKind": "software_trip"})
        while time.monotonic() - started < request["seconds"]:
            if cancelled.is_set(): raise RuntimeError("PPK2_CANCELLED")
            # Bound each library read allocation before get_data reads in_waiting bytes.
            if meter.ser.in_waiting > 400000: raise RuntimeError("PPK2_INPUT_LIMIT")
            raw = meter.get_data()
            if not isinstance(raw, bytes) or len(raw) > 400000: raise RuntimeError("PPK2_INPUT_INVALID")
            raw_bytes += len(raw)
            if raw_bytes > sample_limit * 4: raise RuntimeError("PPK2_INPUT_LIMIT")
            if not raw:
                if time.monotonic() - last_data > 2: raise RuntimeError("PPK2_NO_DATA")
                cancelled.wait(0.001)
                continue
            last_data = time.monotonic()
            framed = byte_carry + raw
            boundary = len(framed) // 4 * 4
            byte_carry = framed[boundary:]
            if boundary == 0: continue
            samples, _digital = meter.get_samples(framed[:boundary])
            if len(samples) != boundary // 4: raise RuntimeError("PPK2_SAMPLE_LOSS")
            if len(samples) > 100001: raise RuntimeError("PPK2_SAMPLE_LIMIT")
            for sample in samples:
                if not isinstance(sample, (int, float)) or not math.isfinite(sample): raise RuntimeError("PPK2_SAMPLE_INVALID")
                if abs(sample) > request["currentLimitMa"] * 1000: raise RuntimeError("PPK2_CURRENT_TRIP")
                if count >= sample_limit: raise RuntimeError("PPK2_SAMPLE_LIMIT")
                count += 1
                total += sample
                in_window += 1
                if in_window == 1000:
                    pending.append(round(total / 1000000.0, 6))
                    total = 0.0
                    in_window = 0
                if len(pending) == 100:
                    emit({"event": "samples", "currentMa": pending})
                    emitted_windows += len(pending)
                    pending = []
        if pending:
            emit({"event": "samples", "currentMa": pending})
            emitted_windows += len(pending)
            pending = []
    except Exception as error:
        known = str(error)
        outcome = known if known.startswith("PPK2_") and len(known) < 80 else "PPK2_IO_FAILED"
    finally:
        collection_finished = time.monotonic()
        if meter is not None:
            # Output-off runs first and independently of stop/close failures.
            if request["mode"] == "source":
                try:
                    meter.toggle_DUT_power("OFF")
                    meter.ser.flush()
                    off_written = True
                    power_may_be_on = False
                except Exception:
                    off_written = False
                    power_may_be_on = True
            try:
                meter.stop_measuring()
                meter.ser.flush()
                stopped = True
            except Exception:
                stopped = not measuring_attempted
            try:
                meter.ser.close()
                serial_closed = not meter.ser.is_open
            except Exception:
                serial_closed = False
        else:
            stopped = True
            serial_closed = True
        emit({"event": "finished", "outcome": outcome, "sampleCount": count, "partialWindowSamples": in_window, "emittedWindows": emitted_windows, "unreportedWindows": len(pending),
              "durationSeconds": collection_finished - started if started is not None else 0, "partialRawBytes": len(byte_carry), "deviceTouched": meter is not None,
              "outputOffWritten": off_written, "outputOffPhysicallyVerified": False,
              "powerMayBeOn": power_may_be_on, "measurementStopped": stopped, "serialClosed": serial_closed})

def main():
    def emit(message):
        sys.__stdout__.write(json.dumps(message, separators=(",", ":"), allow_nan=False) + "\n")
        sys.__stdout__.flush()
    try:
        line = sys.stdin.buffer.readline(16385)
        if len(line) > 16384 or not line.endswith(b"\n"): raise ValueError("PPK2_REQUEST_INVALID")
        request = validate(json.loads(line))
        with contextlib.redirect_stdout(sys.stderr):
            from ppk2_api.ppk2_api import PPK2_API
    except ImportError:
        emit({"event": "unavailable", "code": "PPK2_API_MISSING"})
        return
    except Exception:
        emit({"event": "unavailable", "code": "PPK2_REQUEST_INVALID"})
        return
    cancelled = threading.Event()
    def watch_owner():
        # EOF or any subsequent input requests shutdown; the parent keeps stdin open while collecting.
        sys.stdin.buffer.read(1)
        cancelled.set()
    threading.Thread(target=watch_owner, daemon=True).start()
    with contextlib.redirect_stdout(sys.stderr):
        collect(request, PPK2_API, cancelled, emit)

if __name__ == "__main__":
    main()
    # The daemon owner-reader must not race buffered stdin finalization. All device cleanup ran above.
    os._exit(0)
`;
