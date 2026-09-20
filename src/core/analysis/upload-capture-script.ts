/** Generate a capture-only SCons upload action; installation belongs to the authorized host workflow. */
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";

/** Replace the lazy upload command with final selection capture and a non-success stop before writing. */
export function createUploadCaptureScript(recordPath: string): string {
  if (!path.isAbsolute(recordPath) || /[\x00-\x1f\x7f]/.test(recordPath))
    throw new PlatformIOError(
      "Capture record path must be host-resolved.",
      "UPLOAD_MANIFEST_INVALID",
    );
  return `import hashlib, json, os, stat
from pathlib import Path
Import("env")
_RECORD = json.loads(${JSON.stringify(JSON.stringify(recordPath))})
_ORIGINAL = env.get("UPLOADCMD")
if env.subst("$UPLOAD_PROTOCOL") != "esptool" or not isinstance(_ORIGINAL, str):
    raise ValueError("UPLOAD_CAPTURE_UNSUPPORTED")

def _artifact(value, maximum):
    source = Path(str(value)).resolve(strict=True)
    flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(str(source), flags), "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size < 1 or before.st_size > maximum:
            raise ValueError("UPLOAD_CAPTURE_LIMIT")
        digest = hashlib.sha256()
        size = 0
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > maximum:
                raise ValueError("UPLOAD_CAPTURE_LIMIT")
            digest.update(chunk)
        after = os.fstat(stream.fileno())
        fields = lambda state: (state.st_dev, state.st_ino, state.st_size, state.st_mtime_ns)
        if fields(before) != fields(after) or size != before.st_size:
            raise ValueError("UPLOAD_CAPTURE_CHANGED")
    return {"path": str(source), "sha256": digest.hexdigest(), "size": size}

def _capture_upload(target, source, env):
    if len(source) != 1:
        raise ValueError("UPLOAD_CAPTURE_UNSUPPORTED")
    extra = env.get("FLASH_EXTRA_IMAGES", [])
    if not isinstance(extra, (list, tuple)) or len(extra) > 31:
        raise ValueError("UPLOAD_CAPTURE_LIMIT")
    images = []
    for pair in extra:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            raise ValueError("UPLOAD_CAPTURE_UNSUPPORTED")
        image = _artifact(env.subst(str(pair[1])), 64 * 1024 * 1024)
        image.update(offset=int(env.subst(str(pair[0])), 0), role="data")
        images.append(image)
    image = _artifact(source[0].get_abspath(), 64 * 1024 * 1024)
    image.update(offset=int(env.subst("$ESP32_APP_OFFSET"), 0), role="application")
    images.append(image)
    if sum(item["size"] for item in images) > 128 * 1024 * 1024:
        raise ValueError("UPLOAD_CAPTURE_LIMIT")
    if any(item["offset"] < 0 or item["offset"] + item["size"] > 0x100000000 for item in images):
        raise ValueError("UPLOAD_CAPTURE_LIMIT")
    settings = json.dumps(env.GetProjectOptions(), sort_keys=True, default=str, separators=(",", ":"))
    record = {
        "schemaVersion": 1, "captureOnly": True,
        "commandLine": env.subst(_ORIGINAL, target=target, source=source),
        "projectDir": str(Path(env.subst("$PROJECT_DIR")).resolve(strict=True)),
        "environment": env.subst("$PIOENV"),
        "compiler": env.subst("$CC"),
        "buildSettingsSha256": hashlib.sha256(settings.encode("utf8")).hexdigest(),
        "elf": _artifact(env.subst("$PROG_PATH"), 256 * 1024 * 1024),
        "images": images,
    }
    encoded = json.dumps(record, separators=(",", ":"))
    if len(encoded.encode("utf8")) > 2 * 1024 * 1024:
        raise ValueError("UPLOAD_CAPTURE_LIMIT")
    descriptor = os.open(_RECORD, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf8") as stream:
        stream.write(encoded)
    # SCons must stop here: no original command or later upload actions may run.
    return 86

env.Replace(UPLOADCMD=_capture_upload)
`;
}
