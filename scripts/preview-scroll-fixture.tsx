import "../src/styles.css";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileViewer } from "../src/components/FileViewer.tsx";
import { ChatView } from "../src/components/ChatView.tsx";
import { PiSubagentProvider } from "../src/components/PiSubagents.tsx";
import { SettingsProvider } from "../src/lib/settings.ts";
import { MachineContext } from "../src/lib/machineContext.tsx";
import { OpenFileContext } from "../src/lib/filePaths.ts";

declare global {
  interface Window {
    previewScrollQa: {
      file: (path: string | null) => void;
      refresh: () => void;
      page: (direction: -1 | 1) => void;
    };
  }
}

function Fixture() {
  const [path, setPath] = useState<string | null>("/fixture/a.html");
  const [refresh, setRefresh] = useState(0);
  const pageScroll = useRef<((direction: -1 | 1) => void) | null>(null);
  window.previewScrollQa = { file: setPath, refresh: () => setRefresh((value) => value + 1), page: (direction) => pageScroll.current?.(direction) };
  const html = location.pathname === "/html";
  return <MachineContext.Provider value="local"><OpenFileContext.Provider value={() => {}}>
    {html ? <div style={{ display: "grid", gridTemplateColumns: "minmax(100px, 1fr) minmax(0, 2fr)", height: "100dvh" }}>
      <div><label>Composer<textarea className="composer-text" aria-label="Fixture composer" /></label></div>
      {path && <FileViewer path={path} paneId="fixture" docked onClose={() => setPath(null)} />}
    </div> : <div className="terminal-host"><div className="terminal-stack is-chat" style={{ position: "relative", height: "100dvh", width: "100%" }}>
      <PiSubagentProvider paneId="fixture" visible enabled>
        <ChatView paneId="fixture" refreshKey={refresh} connected ended={false} agent="pi" agentStatus="idle" pageScroll={pageScroll} />
      </PiSubagentProvider>
    </div></div>}
  </OpenFileContext.Provider></MachineContext.Provider>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Fixture root missing");
createRoot(root).render(<SettingsProvider><Fixture /></SettingsProvider>);
