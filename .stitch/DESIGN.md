# Design System: PIO MCP - Kinetic Monolith
**Project ID:** 6116676107464775411

## 1. Visual Theme & Atmosphere
The Creative North Star for the PIO MCP portal is **"The Kinetic Engine."** 

This system rejects the "soft" web interfaces of modern SaaS. It is built for operators and engineers who require high-performance, low-level instrumentation. The aesthetic philosophy is rooted in the raw, uncompromising structural integrity of industrial hardware. It feels like a custom-milled chassis—heavy, permanent, and functional.

**Atmospheric Keys:** 
- **Machined Grit:** Zero-radius corners and absolute 90-degree angles.
- **Boundless Depth:** Use deep glassmorphism and tonal shifts instead of borders.
- **Low-Level Authority:** Monospaced data readouts and system-level metadata (memory offsets, version strings).

## 2. Color Palette & Roles
The palette is rooted in deep carbon and cold steel, punctuated by sharp, high-visibility technical accents.

*   **Obsidian Floor (#131313):** The primary base surface of the application.
*   **Cyan Signal Glow (#00FFD1):** Primary active indicator. Used for "Connected" states, terminal carets, and primary action highlights.
*   **Neon Magenta Spill (#E879F9):** Used as a subtle atmospheric "glow spill" behind primary telemetry modules to create depth and energy.
*   **Emergency Red (#FFB4AB):** Reserved for "Kill" processes, critical flash failures, or locked ports.
*   **Cold Steel (#353535):** Used for inactive modules or structural navigation regions.

### The "No-Line" Rule
**Explicit Instruction:** You are prohibited from using 1px solid borders to define sections or buttons. Boundaries must be established through **Tonal Shifting**. A panel exists because its surface (`surface-container-high`) is physically distinct from the floor (`surface`).

## 3. Typography Rules
Data is the hero. We utilize two distinct voices to establish a hierarchy of "Instruction vs. Action."

*   **The Logic Voice (Fira Code):** Dominates 70% of the UI. Used for all data readouts, terminal logs, code snippets, and technical telemetry. 
    *   *Polish:* Terminal logs should have a subtle chromatic aberration or character-glow effect.
*   **The Instrumentation Voice (Space Grotesk):** Geometric and open. Used strictly for high-level high-level section labels, header titles, and navigational categories.
*   **Metadata Stamping:** All metadata (e.g., software versions, memory addresses like `0x7F4B`) should use `Fira Code` in `label-sm`, all-caps, with a slightly increased letter-spacing to mimic engraved serial numbers.

## 4. Component Stylings
*   **Buttons:** Sharp, zero-radius blocks. Primary buttons use a solid `Cyan Glow` background with deep black text. Secondary buttons are "Ghost" style—no fill, but with a `1px` high-contrast outer glow on hover.
*   **Telemetry Chassis (Cards):** Heavy cards using `surface_container_high`. No borders. Cards "float" through the use of a deep Magenta atmospheric glow behind them, rather than standard drop shadows.
*   **The Core Terminal:** Deep inset "Well" using `surface_container_lowest`. Must feature a subtle CRT-scanline texture overlay.
*   **Theme Toggle:** A "Glass-Industrial" floating component in the bottom right. Heavy frosted glass with zinc/steel metallic edges.

## 5. Layout Principles
*   **Asymmetry:** Layouts should feel custom-engineered. Avoid perfectly centered stacks; lean into heavy left-aligned structural blocks (Workspaces) balanced by wide, airy terminal regions.
*   **Depth through Stacking:** Modules should feel like physical slices of hardware stacked on the floor. Use tonal shifts (`surface_low` to `surface_high`) to communicate nesting.
*   **Instrumentation Density:** Don't be afraid of "Data Richness." The interface should feel packed with useful technical strings, as long as the hierarchy is clear.
