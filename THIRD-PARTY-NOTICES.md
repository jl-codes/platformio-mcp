# Third-party notices

## platformio.mcp reference contracts

Compatibility contract metadata is derived from the public interface of
[powerdragonfire/platformio.mcp](https://github.com/powerdragonfire/platformio.mcp)
at commit `a7b31021982f20b5406eaf80732899f8e75bd464`.
The reference project is independent of jl-codes/platformio-mcp; compatibility
names do not imply affiliation or ownership of its distribution identities.

The heap, stack, and generic memory label patterns in `src/core/memory-telemetry-parser.ts` are adapted
from the pinned reference `parsers.py`, with bounded numeric parsing, explicit
word-size handling, and source-order observations.

Board compatibility filtering, compact fields and summaries in `src/adapters/board-compat.ts` are adapted from the pinned reference `project.py` and use this project's canonical catalog and permission dispatcher.

The pinned reference license follows:

MIT License

Copyright (c) 2026 Mihir Gandecha

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## MCP Registry validation schema (development tooling)

`distribution/mcp-server.schema.json` is copied from the official Model Context Protocol Registry at the commit and path recorded in `distribution/mcp-schema-source.json`. Its SHA-256 is checked by the validator. The upstream license is preserved in `distribution/MCP-REGISTRY-LICENSE`; the schema is used for release validation and is not bundled in the npm runtime.
