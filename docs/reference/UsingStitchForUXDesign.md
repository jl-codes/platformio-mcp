# Best-Practice Stitch Design Process: PIO MCP Web Portal

Designing UIs autonomously requires shifting from a "code first" mindset to a "specification first" mindset. The Stitch MCP server acts as an AI-native design tool. If we feed it raw code requirements ("Make a div with a PID"), it will generate flat, uninspired wireframes. If we feed it rich, atmospheric design specifications ("Render a glassmorphic data-card representing a hardware lock, using Space Grotesk"), it will generate premium, production-ready interfaces.

Because you are highly technical, think of this process as **compiling a design**. 
1. We write the *configuration* (Design System).
2. We write the *source code* (Enhanced Prompts).
3. Stitch *compiles* it into visual pixels (Layouts).
4. Our agent suite *transpiles* the pixels back into React code (Component Integration).

Here is the proposed phased workflow.

## Phase 1: The Foundation (Design System Synthesis)
**Goal:** Establish the ground rules so the AI doesn't hallucinate creative decisions.

1. **Create the Project:** We will use `mcp_stitch_create_project` to isolate the new portal work from the old.
2. **Apply Design System:** We will invoke `mcp_stitch_create_design_system` to hard-code "The Kinetic Monolith" tokens (e.g., `#0B0F19` background, `#6366F1` accents).
3. **Capture the Ruleset:** Using the `design-md` skill, we will write `.stitch/DESIGN.md`. This is our Design API Contract. It teaches future agents *how* to use the tokens (e.g., "Always use Fira Code for logs").

*Why:* In design, systemic consistency is vastly more important than isolated brilliance. By locking in our tokens and layout philosophies globally, every screen we generate subsequently is guaranteed to feel like it belongs to the same application.

## Phase 2: Generation via Prompt Enhancement
**Goal:** Translate your functional requirements into the precise UI/UX language the Stitch model understands.

1. **You Define the Goal:** You say: *"I need a global workspace manager screen that shows registered projects."*
2. **The Prompt Layer (`stitch-design` & `enhance-prompt` skills):** I will intercept your request and expand it. I will read the `.stitch/DESIGN.md`, apply our rules, and produce a prompt like: *"Generate a Workspace Manager dashboard. Use intentional asymmetry. Background must be `surface` (#0f131d). The primary list should use `surface_container_low`..."*
3. **The Generation:** We pass the enhanced prompt to `mcp_stitch_generate_screen_from_text`.

*Why:* Technical users often describe structure (a list, a button, a table). Designers describe hierarchy, lighting, and pacing. The `enhance-prompt` skill translates function into form automatically, ensuring the output feels premium.

## Phase 3: Surgical Iteration (`stitch-loop`)
**Goal:** Refine the 80% baseline into a 100% final design without destroying what already works.

1. **Review:** You look at the generated screen in the web dashboard.
2. **Targeted Feedback:** You say: *"The project list item is too large. Make it a compact pill."*
3. **Iterative Edit:** We *do not* regenerate the whole screen. We use `mcp_stitch_edit_screens` or `mcp_stitch_generate_variants` on that specific screen ID.

*Why:* Large visual AI models are non-deterministic; regenerating a full page just to fix a button often ruins the layout. The `stitch-loop` strategy relies on making surgical, cumulative edits.

## Phase 4: Code Extraction & Integration (`react:components`)
**Goal:** Migrate the visual prototypes into your live React/Express system.

1. **Extraction:** Once a screen is approved, we will use the `react:components` skill to analyze the Stitch elements.
2. **Componentization:** The agent will convert the flat UI into stateful Vite/React TSX files (e.g., carving out the `ActiveTaskRegistry.tsx` separate from the `SerialMonitorTabs.tsx`).
3. **Wire in Logic:** We hook the UI components up to your existing `socket.io` data streams.

*Why:* Stitch is a layout designer, not an application architect. A monolithic HTML export isn't usable. We must decompose the design back into modular React elements so we can bind the global `workspaces.json` and hardware `PID` states securely.

---

## User Review Required

Does this conceptual workflow make sense? 

If you approve of this structure, our immediate next step will be to execute **Phase 1**: Initializing the new specific web-portal project in Stitch, applying the design system primitives, and synthesizing the `.stitch/DESIGN.md` ruleset locally so we can begin generating the revised layout components.
