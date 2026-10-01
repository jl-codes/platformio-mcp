/**
 * PIO Agent conversation panel backed by the MCP Apps host bridge.
 *
 * Provides:
 * - Panel: Project, device, task, and log workspace with a policy-governed build.
 */

import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import { McpDashboardTransport, type DashboardSnapshot, type DashboardTaskOutput } from "./lib/mcp-dashboard-transport.js";

/** MCP Apps instance for this panel document. */
const app = new App({ name: "PIO Agent", version: "1.0.0" }, {});

/** Presents bounded current state without exposing approval mutations. */
function Panel() {
  const transport = useMemo(() => new McpDashboardTransport(app), []);
  const [connected, setConnected] = useState(false);
  const [projectInput, setProjectInput] = useState("");
  const [projectDir, setProjectDir] = useState("");
  const [environment, setEnvironment] = useState("");
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [selectedTask, setSelectedTask] = useState("");
  const [taskOutput, setTaskOutput] = useState<DashboardTaskOutput | null>(null);
  const [buildResult, setBuildResult] = useState<unknown>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    app.ontoolinput = (input) => {
      const selected = typeof input.arguments?.projectDir === "string" ? input.arguments.projectDir : "";
      if (mounted) { setProjectInput(selected); setProjectDir(selected); }
    };
    app.connect().then(() => { if (mounted) setConnected(true); }).catch((failure: unknown) => {
      if (mounted) setError(String(failure));
    });
    return () => { mounted = false; app.ontoolinput = undefined; app.close(); };
  }, []);

  useEffect(() => {
    if (!connected || !projectDir) return;
    let active = true;
    const refresh = async () => {
      try {
        const current = await transport.readSnapshot(projectDir);
        if (active) { setSnapshot(current); setError(""); }
      } catch (failure) { if (active) setError(String(failure)); }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [connected, projectDir, transport]);

  useEffect(() => {
    if (!connected || !projectDir || !selectedTask) return;
    const task = snapshot?.tasks.find((item) => item.taskId === selectedTask);
    if (!task) return;
    let active = true;
    const refresh = async () => {
      try {
        const current = await transport.readTask(projectDir, task);
        if (active) { setTaskOutput(current); setError(""); }
      } catch (failure) { if (active) setError(String(failure)); }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [connected, projectDir, selectedTask, snapshot?.tasks, transport]);

  const selectProject = () => {
    setSnapshot(null); setSelectedTask(""); setTaskOutput(null); setBuildResult(null);
    setProjectDir(projectInput.trim());
  };
  const build = async () => {
    if (!projectDir) return;
    setWorking(true);
    try {
      setBuildResult(await transport.build(projectDir, environment.trim() || undefined));
      setSnapshot(await transport.readSnapshot(projectDir));
      setError("");
    } catch (failure) { setError(String(failure)); }
    finally { setWorking(false); }
  };
  const openBrowser = async () => {
    if (!projectDir) return;
    setWorking(true);
    try { await transport.openBrowserDashboard(projectDir); setError(""); }
    catch (failure) { setError(String(failure)); }
    finally { setWorking(false); }
  };

  return <main style={{ fontFamily: "system-ui, sans-serif", padding: 16, color: "#dcebf9", background: "#07111f", minHeight: "100vh" }}>
    <header style={{ borderBottom: "1px solid #254465", marginBottom: 16 }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 22 }}>PIO Agent</h1>
      <p style={{ margin: "0 0 12px", color: "#9eb8d1" }}>PlatformIO control plane · {connected ? "Connected" : "Connecting"}</p>
    </header>
    <section aria-label="Project selection" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
      <label style={{ flex: "1 1 240px" }}>Project directory<br /><input value={projectInput} onChange={(event) => setProjectInput(event.target.value)} style={{ width: "100%" }} /></label>
      <button type="button" disabled={!connected || !projectInput.trim()} onClick={selectProject}>Select project</button>
    </section>
    {projectDir && <>
      <p style={{ overflowWrap: "anywhere" }}>Viewing <strong>{projectDir}</strong></p>
      <section aria-label="Project actions" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label>Environment<br /><input value={environment} onChange={(event) => setEnvironment(event.target.value)} /></label>
        <button type="button" disabled={!connected || working} onClick={() => { void build(); }}>Build project</button>
        <button type="button" disabled={!connected || working} onClick={() => { void openBrowser(); }}>Open browser dashboard</button>
      </section>
      <p style={{ color: "#9eb8d1", fontSize: 12 }}>Hardware approval requires trusted local operator enrollment in the browser dashboard or the local CLI.</p>
    </>}
    {error && <p role="alert" style={{ color: "#ff9f9f" }}>{error}</p>}
    {buildResult !== null && <section><h2>Build</h2><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(buildResult, null, 2)}</pre></section>}
    {snapshot && <>
      <section><h2>Project</h2><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(snapshot.project, null, 2)}</pre></section>
      <section><h2>Devices</h2><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(snapshot.devices, null, 2)}</pre></section>
      <section><h2>Policy</h2><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(snapshot.policy, null, 2)}</pre></section>
      <section><h2>Hardware lock</h2><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(snapshot.lock, null, 2)}</pre></section>
      <section><h2>Pending approvals</h2><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(snapshot.approvals, null, 2)}</pre></section>
      <section><h2>Serial monitor</h2><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(snapshot.monitor, null, 2)}</pre></section>
      <section><h2>Recent tasks</h2><p style={{ color: "#9eb8d1", fontSize: 12 }}>Updated {snapshot.observedAt}</p>
        {snapshot.tasks.length === 0 ? <p>No tracked tasks in this project.</p> : <ul style={{ paddingLeft: 18 }}>
          {snapshot.tasks.map((task) => <li key={task.taskId} style={{ marginBottom: 8 }}>
            <button type="button" onClick={() => { setTaskOutput(null); setSelectedTask(task.taskId); }} aria-pressed={selectedTask === task.taskId}>
              {task.type} · {task.status} · {task.startedAt}
            </button>
          </li>)}
        </ul>}
      </section>
    </>}
    {taskOutput && <section aria-live="polite"><h2>Task {taskOutput.taskId} · {taskOutput.status}</h2><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 420, overflowY: "auto" }}>{taskOutput.output}</pre></section>}
  </main>;
}

const root = document.getElementById("pio-agent-root");
if (root) createRoot(root).render(<Panel />);
