import "../src/styles.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from "../src/components/ChatView.tsx";
import { StatusBadge } from "../src/components/Sidebar.tsx";
import { SettingsProvider } from "../src/lib/settings.ts";
import { MachineContext } from "../src/lib/machineContext.tsx";
import { OpenFileContext } from "../src/lib/filePaths.ts";

declare global { interface Window { providerFailureQa: { refresh: (status: "working" | "failed" | "done") => void }; } }
function Fixture() {
  const [status, setStatus] = useState<"working" | "failed" | "done">("failed");
  const [refresh, setRefresh] = useState(0);
  window.providerFailureQa = { refresh: (value) => { setStatus(value); setRefresh((key) => key + 1); } };
  return <MachineContext.Provider value="local"><OpenFileContext.Provider value={() => {}}>
    <div className="terminal-host" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 8 }}><StatusBadge status={status} /> <input aria-label="Fictional composer" placeholder="This fixture never sends input" /></div>
      <div className="terminal-stack is-chat" style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <ChatView paneId="fictional-provider" refreshKey={refresh} connected ended={false} agent="codex" agentStatus={status} />
      </div>
    </div>
  </OpenFileContext.Provider></MachineContext.Provider>;
}
const root = document.getElementById("root");
if (!root) throw new Error("Fixture root missing");
createRoot(root).render(<SettingsProvider><Fixture /></SettingsProvider>);
