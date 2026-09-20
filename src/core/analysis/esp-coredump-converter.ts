/** Fixed optional converter program; Python must be host-resolved and launched with isolated mode. */
export const ESP_COREDUMP_VERSION = "1.10.0";

/** Converts validated raw input to a core ELF without starting GDB, accessing devices or installing packages. */
export const ESP_COREDUMP_CONVERTER = String.raw`
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import sys
import tempfile


def main():
    if importlib.metadata.version("esp-coredump") != "1.10.0":
        raise ValueError("COREDUMP_TOOL_VERSION_MISMATCH")
    if len(sys.argv) != 5:
        raise ValueError("COREDUMP_CONVERTER_ARGUMENTS")
    raw, elf, staging = [Path(value) for value in sys.argv[1:4]]
    machine = int(sys.argv[4])
    if machine not in (94, 243):
        raise ValueError("COREDUMP_ELF_TARGET_MISMATCH")
    if not all(value.is_absolute() for value in (raw, elf, staging)):
        raise ValueError("COREDUMP_CONVERTER_ARGUMENTS")
    staging = staging.resolve(strict=True)
    raw = raw.resolve(strict=True)
    elf = elf.resolve(strict=True)
    if raw.parent != staging or not raw.is_file() or not elf.is_file():
        raise ValueError("COREDUMP_CONVERTER_ARGUMENTS")
    if raw.stat().st_size > 16 * 1024 * 1024 or elf.stat().st_size > 256 * 1024 * 1024:
        raise ValueError("COREDUMP_INPUT_LIMIT")
    logging.disable(logging.CRITICAL)
    from esp_coredump.corefile.loader import ESPCoreDumpFileLoader

    class StagedLoader(ESPCoreDumpFileLoader):
        def _create_temp_file(self):
            descriptor, name = tempfile.mkstemp(prefix="converted-", suffix=".elf", dir=staging)
            os.close(descriptor)
            self.temp_files.append(name)
            return name

    loader = None
    keep = None
    try:
        loader = StagedLoader(str(raw), is_b64=False)
        loader.create_corefile(exe_name=str(elf), e_machine=machine)
        output = Path(loader.core_elf_file).resolve(strict=True)
        if output.parent != staging or not output.is_file() or output.stat().st_size > 32 * 1024 * 1024:
            raise ValueError("COREDUMP_CONVERSION_INVALID")
        with output.open("rb") as stream:
            if stream.read(7) != bytes.fromhex("7f454c46010101"):
                raise ValueError("COREDUMP_CONVERSION_INVALID")
        keep = output
        print(json.dumps({"core_path": str(output), "converter_version": "1.10.0"}))
    finally:
        if loader is not None:
            for name in loader.temp_files:
                candidate = Path(name)
                if candidate.parent == staging and candidate != keep:
                    candidate.unlink(missing_ok=True)


try:
    main()
except importlib.metadata.PackageNotFoundError:
    print(json.dumps({"error": "COREDUMP_TOOL_UNAVAILABLE"}))
    sys.exit(2)
except Exception as error:
    code = str(error)
    if code not in {
        "COREDUMP_TOOL_VERSION_MISMATCH", "COREDUMP_CONVERTER_ARGUMENTS",
        "COREDUMP_ELF_TARGET_MISMATCH", "COREDUMP_INPUT_LIMIT", "COREDUMP_CONVERSION_INVALID"
    }:
        code = "COREDUMP_CONVERSION_FAILED"
    print(json.dumps({"error": code}))
    sys.exit(2)
`;
