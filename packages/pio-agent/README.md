# pio-agent

Product-name npm alias for [PIO Agent](https://www.npmjs.com/package/platformio-mcp).
It delegates entirely to the canonical `platformio-mcp` package and preserves
the same CLI behavior.

```bash
npx pio-agent dashboard
npx pio-agent install --codex
npx pio-agent install --codex-plugin
npx pio-agent devices
npx pio-agent boards --filter esp32
```

For full documentation see the
[platformio-mcp README](https://github.com/jl-codes/platformio-mcp#readme).
