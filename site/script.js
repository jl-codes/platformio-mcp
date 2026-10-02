/** Interactive examples and installation helpers for the PIO Agent landing page. */
const scenarios = {
  bringup: {
    prompt: "“Find my ESP32, create a blink project, and check that it boots.”",
    steps: [
      "Discover connected boards",
      "Initialize project & build firmware",
      "Request approval to flash",
      "Monitor serial output for BOOT_OK",
    ],
    result: "A first boot you can verify.",
  },
  diagnose: {
    prompt: "“This firmware won’t compile. Find the cause and help me fix it.”",
    steps: [
      "Validate the project configuration",
      "Build & collect structured diagnostics",
      "Inspect missing libraries and errors",
      "Let your agent propose a targeted fix",
    ],
    result: "Less log hunting. A clearer next step.",
  },
  verify: {
    prompt:
      "“Flash this build, look for BOOT_OK, and flag any crash messages.”",
    steps: [
      "Check policy & obtain flash approval",
      "Upload firmware to the selected board",
      "Watch for expected boot markers",
      "Report failures and runtime evidence",
    ],
    result: "Evidence from the device itself.",
  },
};

document.querySelectorAll("[data-scenario]").forEach((button) => {
  button.addEventListener("click", () => {
    const scenario = scenarios[button.dataset.scenario];
    document.querySelectorAll("[data-scenario]").forEach((item) => {
      const selected = item === button;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    document.querySelector("#scenario-prompt").textContent = scenario.prompt;
    const steps = scenario.steps.map((step, index) => {
      const paragraph = document.createElement("p");
      const number = document.createElement("span");
      number.textContent = String(index + 1).padStart(2, "0");
      paragraph.append(number, document.createTextNode(step));
      return paragraph;
    });
    document.querySelector("#scenario-steps").replaceChildren(...steps);
    document.querySelector("#scenario-result").textContent =
      `✓ ${scenario.result}`;
  });
});

const hostSelect = document.querySelector("#host-select");
const command = document.querySelector("#install-command");
const copyStatus = document.querySelector("#copy-status");
const codexPluginCommands =
  "codex plugin marketplace add jl-codes/platformio-mcp --ref main\n" +
  "codex plugin add platformio-mcp@platformio-mcp";
document.querySelectorAll("[data-codex-install]").forEach((link) => {
  link.addEventListener("click", () => {
    hostSelect.value = "codex-plugin";
    command.textContent = codexPluginCommands;
    copyStatus.textContent = "";
  });
});
hostSelect.addEventListener("change", () => {
  command.textContent = hostSelect.value === "codex-plugin"
    ? codexPluginCommands
    : `npx platformio-mcp install --${hostSelect.value}`;
  copyStatus.textContent = "";
});

document.querySelector("#copy-command").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(command.textContent);
    copyStatus.textContent = "Copied. Paste it into your terminal.";
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(command);
    selection.removeAllRanges();
    selection.addRange(range);
    copyStatus.textContent = "Command selected. Press Ctrl+C or ⌘C to copy.";
  }
});

// A user-requested handoff shares documentation; it does not grant installation or device access.
document
  .querySelector("#copy-agent-brief")
  .addEventListener("click", async () => {
    const brief =
      "Read https://pioagent.dev/llms.txt and https://pioagent.dev/agents/ to assess whether PIO Agent (platformio-mcp) fits this embedded project. Explain the relevant capabilities, prerequisites, and installation options before making changes. Hardware writes require the applicable user approvals.";
    const status = document.querySelector("#brief-status");
    try {
      await navigator.clipboard.writeText(brief);
      status.textContent = "Copied. Paste it into your agent’s chat.";
    } catch {
      status.textContent = brief;
    }
  });
