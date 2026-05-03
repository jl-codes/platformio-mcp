# Web UX Design Specification
**Project:** PlatformIO MCP Server Portal
**Role:** AI-Augmented IDE Console & Hardware Controller

---

## Table of Contents

1. [Design System & Atmosphere](#1-design-system--atmosphere)
2. [Layout Architecture (Workspace Cockpit)](#2-layout-architecture-workspace-cockpit)
3. [Focal Interactive State: "Add Monitor" Launcher](#3-focal-interactive-state-add-monitor-launcher)
4. [Stitch UX Design Process](#4-stitch-ux-design-process)
5. [Historical Architectural Decision Records](#5-historical-architectural-decision-records)

---

## 1. Design System & Atmosphere

**Vibe & Mood**
*   **Aesthetic:** Developer-first, high-end "Cyber-Industrial" / Modern IDE.
*   **Atmosphere:** Sleek, precise, and utilitarian with strategic bursts of vibrant color to indicate hardware state or danger. 
*   **Texture:** Subtle glassmorphism on floating panels to create depth against a deep, dark canvas.

**Color Palette**
*   **Background (Base):** Deep dark gray/black (e.g., `#0F1215`).
*   **Surface (Panels):** Slightly elevated dark gray (e.g., `#1A1D24`) with an optional 10% opacity white border for crispness.
*   **Primary Accent (Active State):** Vibrant Neon Blue or Cyber Green (e.g., `#00FF9D`). Used for active hardware connections, "Start" buttons, and live terminal tabs.
*   **Destructive / Alert (Kill State):** Striking Crimson/Red (e.g., `#FF3366`). Used exclusively for "Kill PID", "Stop Monitor", and the "Reset Server State" actions.
*   **Text (Primary):** Near white (e.g., `#E2E8F0`).
*   **Text (Muted):** Cool gray (e.g., `#94A3B8`) for PIDs, paths, and secondary labels.

**Typography**
*   **UI/Structural Text:** `Inter`, `Roboto`, or similar clean Sans-Serif font for UI elements (buttons, headers, navigation).
*   **Console/System Text:** `Fira Code`, `JetBrains Mono`, or similar monospace font for PIDs, file paths, and terminal logs.

---

## 2. Layout Architecture (Workspace Cockpit)

The dashboard acts as a "flight recorder" and control console, restructured around the React + Vite + Socket.io V2 Architecture. It is segmented into four primary zones:

### A. The Header (Global Status)
*   **Left:** App Title / Branding ("⚡️ PIO MCP Server").
*   **Right:** Global Hardware Queue Status indicator, communicating real-time Hardware Rack locking view (e.g., `[🔒 Hardware: Free ]` or `[🔒 Hardware: Locked by Agent ]`).

### B. Left-Hand Workspace Sidebar ("Command Action Feed" / CommandRegistry)
*   **Purpose:** A chronological Command Action Feed and workspace navigator driven by the `CommandRegistry`. It natively maps websocket logs to proper UUID `artifactId` streams.
*   **Components:**
    *   **Action Feed:** A unified vertical list of dispatched async build and monitor events instead of just OS processes.
    *   **Process Items:** Each row displays the task execution state, PID (monospace), and a prominent "Stop / 🗡️ Kill" button emitting the red destructive color on hover.
    *   **Bottom Anchor:** A dramatic, full-width "Reset Server State" emergency button.

### C. Top Main Area ("Command Launcher" Toolbar)
*   **Purpose:** A functional-led horizontal command launcher mapping to core MCP execution verbs (`build`, `upload_firmware`, `check_project`, `run_tests`).
*   **Components:**
    *   Current project path indicator.
    *   Action Button Group:  `[🛠️ Build]`, `[🚀 Flash Firmware]`, `[📁 Flash FS]`, `[✔️ Check]`, `[🧪 Test]`.
    *   **Styling:** Medium elevation, standard primary buttons.

### D. Right Sidebar ("Dependencies Viewer")
*   **Purpose:** A strict read-only parser of the project environment displaying `platformio.ini` configurations.
*   **Components:**
    *   Interactive library tools.
    *   `pio home` deep link to delegate complex system exploration (Hybrid UI PIO Home delegation).

### E. Bottom Main Area ("Console & Terminal")
*   **Purpose:** A tabbed interface displaying active system logs hydrated dynamically via the Universal Spooler topology.
*   **Components:**
    *   **Tab Bar:** `[ Build Logs ]`, `[ 🔌 usbmodem14101 ]`, `[ ➕ Add Monitor ]`.
    *   **Active Tab Content:** Scrolls a live monospace text feed of the build or serial logs, uniquely identified via UUID tracing.

### F. Global Footer
*   **Purpose:** Provides persistent state indicators, diagnostic UUIDs, and quick actions across the entire application interface.
*   **Components:**
    *   Result status, CLI command snippet, and MCP telemetry links.

---

## 3. Focal Interactive State: "Add Monitor" Launcher

When the user clicks the **`[ ➕ Add Monitor ]`** tab, the standard terminal text area transitions to the **Device Selection Launcher**.

**Structure & Behavior:**
*   **Layout:** A responsive masonry or standard grid of beautifully designed "Hardware Cards."
*   **Card Anatomy:**
    *   **Iconography:** A USB or plug icon.
    *   **Port Name:** The physical path (e.g., `/dev/cu.usbmodem14101`).
    *   **Configuration:** A sleek, inline dropdown menu for selecting the Baud Rate (default `115200`).
    *   **Action:** A vibrant, glowing `[ ▶ Start Monitoring ]` button at the bottom of the card, acting as an ergonomic inline global play/stop wrapper on the Hardware Rack for instant monitor toggles.
*   **Interaction:** Clicking "Start" initiates the background daemon connection, organically dismisses the launcher grid, and transitions the view directly into the live log stream for that newly created tab.

---

## 4. Stitch UX Design Process

The current UI React component topology was entirely orchestrated through the `@stitch-design` skill in tandem with `@react:components`. 
*   **Design Prompts:** Use the prompt generator (like the one below) to bootstrap updates via the Stitch MCP.
*   **Architecture Mapping:** Hand-off Stitch layout JSON payloads directly to `react:components` to translate into functional React artifacts bound to `socket.io` contexts.

### Stitch Prompt Generator (Copy/Paste Ready)

```markdown
Design a premium, dark-mode Web Dashboard for an AI-augmented Developer IDE that manages low-level hardware builds and serial ports.

**DESIGN SYSTEM (REQUIRED):**
- Platform: Web, Desktop-first
- Palette: Background (#0F1215), Panels (#1A1D24), Active/Primary UI (#00FF9D for connected/start states), Destructive (#FF3366 for Kill/Stop states).
- Styles: Sleek Cyber-Industrial. Deep backgrounds with floating glassmorphism panels. 
- Typography: Inter for UI text, JetBrains Mono for system PIDs and paths.

**PAGE STRUCTURE:**
1. **Header:** "PIO MCP" brand logo on the left, and a "Hardware Queue: Free" status badge on the right.
2. **Left Sidebar:** Title it "Command Action Feed". List active background tasks from the CommandRegistry showing a monospace PID, task state, and a red "Kill" button. Put a large "Reset Server State" red button at the absolute bottom.
3. **Workspace Toolbar (Top Main):** A sleek horizontal bar showing a directory path and 5 action buttons: [Build], [Flash Firmware], [Flash FS], [Check], [Test].
4. **Right Sidebar:** Title it "Dependencies Viewer". Read-only list of installed dependencies and a link to open "PIO Home".
5. **Console Area (Bottom Main):** A tabbed interface. Show tabs for "Build Logs" and "➕ Add Monitor". The "Add Monitor" tab is currently active.
6. **Main Content (Focus):** Because the "Add Monitor" tab is active, instead of showing text logs, the main body displays a "Device Selection Launcher". Show a 3-column grid of beautiful Cards representing detected USB ports. Each card has a USB icon, the port path (`/dev/cu.usb123`), a dropdown for Baud Rate (115200), and a neon green "Start Monitoring" button.
```

---

## 5. Historical Architectural Decision Records

The following documents track early architectural evaluations and are preserved here as Historical Architectural Decision Records (ADRs):

- [Design Evaluation Archive](archive/DesignEvaluation.md)
