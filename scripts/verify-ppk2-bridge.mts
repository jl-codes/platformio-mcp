/** Exercise the PPK2 bridge against a fake meter API in native Python; never imports serial or opens hardware. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PPK2_BRIDGE } from "../src/core/power/ppk2-bridge.ts";
const python = process.argv[2];
if (!python || !path.isAbsolute(python)) throw new Error("Pass an absolute Python interpreter.");
const fixture = String.raw`
import json, sys, threading
namespace = {"__name__": "fixture"}
exec(json.loads(sys.stdin.read()), namespace)
collect = namespace["collect"]
validate = namespace["validate"]

class Port:
    in_waiting = 4000
    is_open = True
    def write(self, data): return len(data)
    def flush(self): pass
    def close(self): self.is_open = False

class Meter:
    events = []
    fail = None
    sample = 1000.0
    def __init__(self, port, **options):
        self.ser = Port()
        self.events.append("open")
        if self.fail == "init": raise RuntimeError("failure")
    def toggle_DUT_power(self, state):
        self.events.append(state)
        if state == self.fail: raise RuntimeError("failure")
    def get_modifiers(self):
        self.events.append("metadata")
        if self.fail == "metadata": raise RuntimeError("failure")
    def use_source_meter(self): self.events.append("source")
    def set_source_voltage(self, voltage): self.events.append("voltage")
    def use_ampere_meter(self): self.events.append("ampere")
    def start_measuring(self): self.events.append("start")
    def stop_measuring(self):
        self.events.append("stop")
        if self.fail == "stop": raise RuntimeError("failure")
    def get_data(self): return b"0" * 4000
    def get_samples(self, raw):
        if self.fail == "decode": return [], []
        return [self.sample] * (len(raw) // 4), []

def run(mode="source", fail=None, sample=1000.0, cancelled=False):
    Meter.events = []
    Meter.fail = fail
    Meter.sample = sample
    ticks = iter(i / 1000 for i in range(100000))
    namespace["time"].monotonic = lambda: next(ticks)
    stop = threading.Event()
    if cancelled: stop.set()
    output = []
    collect({"port": "FAKE", "mode": mode, "voltageMv": 3300, "currentLimitMa": 50, "seconds": 0.01}, Meter, stop, output.append)
    assert output[-1]["event"] == "finished"
    return output, Meter.events[:]

output, events = run()
assert events[:5] == ["open", "OFF", "metadata", "source", "voltage"], events
assert events[-2:] == ["OFF", "stop"], events
assert output[-1]["outputOffWritten"] and output[-1]["serialClosed"] and output[-1]["measurementStopped"]
assert not output[-1]["outputOffPhysicallyVerified"]
assert any(row.get("currentMa") and row["currentMa"][0] == 1 for row in output)
output, events = run("ampere")
assert "ON" not in events and "voltage" not in events and "source" not in events
assert output[-1]["outcome"] == "complete"
output, events = run(sample=51000.0)
assert output[-1]["outcome"] == "PPK2_CURRENT_TRIP" and events[-2:] == ["OFF", "stop"]
output, events = run(fail="OFF")
assert output[-1]["powerMayBeOn"] and not output[-1]["outputOffWritten"] and output[-1]["serialClosed"]
output, events = run(fail="stop")
assert output[-1]["outputOffWritten"] and not output[-1]["measurementStopped"] and output[-1]["serialClosed"]
output, events = run(fail="ON")
assert events[-2:] == ["OFF", "stop"] and output[-1]["outputOffWritten"]
output, events = run(fail="init")
assert events[-2:] == ["OFF", "stop"] and output[-1]["serialClosed"]
output, events = run(fail="decode")
assert output[-1]["outcome"] == "PPK2_SAMPLE_LOSS"
output, events = run(cancelled=True)
assert not events and output[-1]["outcome"] == "PPK2_CANCELLED" and not output[-1]["deviceTouched"]
for change in ({"mode": "automatic"}, {"voltageMv": 799}, {"currentLimitMa": 601}, {"seconds": float("nan")}, {"seconds": True}):
    request = {"port": "FAKE", "mode": "source", "voltageMv": 3300, "currentLimitMa": 50, "seconds": 1}
    request.update(change)
    try: validate(request)
    except ValueError: pass
    else: raise AssertionError(change)
print(json.dumps({"passed": True, "physicalDeviceContacted": False, "scenarios": 14, "nativePython": sys.version.split()[0]}))
`;
const result = spawnSync(python, ["-I", "-c", fixture], { input: JSON.stringify(PPK2_BRIDGE), encoding: "utf8", timeout: 10000, windowsHide: true, maxBuffer: 65536 });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
