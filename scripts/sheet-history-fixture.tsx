/** Fictional component fixture. Never connects to a native runtime. */
import "../src/styles.css";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MoreHorizontal } from "lucide-react";
import { FilesDialog } from "../src/components/FilesDialog.tsx";
import { FileViewer } from "../src/components/FileViewer.tsx";
import { RepoDiffViewer } from "../src/components/RepoDiffViewer.tsx";
import { ConfirmDialog } from "../src/components/ConfirmDialog.tsx";
import { NewSessionDialog } from "../src/components/NewSessionDialog.tsx";
import { RowMenu } from "../src/components/RowMenu.tsx";
import { SettingsProvider } from "../src/lib/settings.ts";
import { SettingsDialog } from "../src/components/SettingsDialog.tsx";
import { useUpdates } from "../src/lib/updates.ts";
import type { AppActions } from "../src/lib/actions.ts";
import { MachineContext } from "../src/lib/machineContext.tsx";
import { useFileViewer } from "../src/lib/useFileViewer.ts";
import { useRepoDiffViewer } from "../src/lib/useRepoDiffViewer.ts";
import { onSettingsHistory, recordSettings, settingsEntry } from "../src/lib/settingsHistory.ts";
import { sheetHolds } from "../src/lib/sheetHistory.ts";

declare global {
  interface Window {
    sheetQa: {
      confirm: () => void;
      closeConfirm: () => void;
      refuseConfirm: () => void;
      closeFileAndConfirm: () => void;
      closeDiffAndConfirm: () => void;
      closeSettingsAndConfirm: () => void;
      closeRealSettingsAndConfirm: () => void;
      reopen: () => void;
    };
  }
}
function Fixture() {
  const [files, setFiles] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const refuse = useRef<((error: Error) => void) | null>(null);
  const [newSession, setNewSession] = useState(false);
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const [realSettings, setRealSettings] = useState(false);
  const actual = useRef(false); actual.current = realSettings;
  const updates = useUpdates(false); // never poll or request managed updates
  const [level, setLevel] = useState(1);
  const [pane, setPane] = useState("b");
  const anchor = useRef<HTMLButtonElement>(null);
  const file = useFileViewer();
  const diff = useRepoDiffViewer();
  useEffect(() => {
    // Fictional pane routing follows App's sheet/settings guards; no native selection.
    if (!history.state?.fixture) {
      history.replaceState({ fixture: "base", unknown: { preserved: true } }, "", "?pane=a");
      history.pushState({ fixture: "pane", unknown: { preserved: true } }, "", "?pane=b");
    }
    const pop = (event: PopStateEvent): void => {
      if (!sheetHolds(event) && settingsEntry(event.state) === null) setPane(new URL(location.href).searchParams.get("pane") ?? "a");
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => onSettingsHistory((entry, own) => {
    if (own) return;
    if (entry === null) { setSettings(false); setRealSettings(false); }
    else if (!actual.current) setLevel(entry.depth);
  }), []);
  useEffect(() => {
    if (!realSettings) recordSettings(settings ? [{ page: null, keyBar: false }, ...(level > 1 ? [{ page: "appearance", keyBar: false }] : [])] : []);
  }, [settings, level, realSettings]);
  window.sheetQa = {
    confirm: () => setConfirm(true), closeConfirm: () => setConfirm(false),
    refuseConfirm: () => { refuse.current?.(new Error("Fictional action refused.")); refuse.current = null; },
    closeFileAndConfirm: () => { file.closeFile(); setConfirm(true); },
    closeDiffAndConfirm: () => { diff.closeDiff(); setConfirm(true); },
    closeSettingsAndConfirm: () => { recordSettings([]); setSettings(false); setConfirm(true); },
    closeRealSettingsAndConfirm: () => { setRealSettings(false); setConfirm(true); },
    reopen: () => { setConfirm(false); setTimeout(() => setConfirm(true), 0); },
  };
  const openFile = (path: string): void => file.openFile({ path, machineId: "local", paneId: "fictional-pane" });
  const noop = (): void => {};
  const actions: AppActions = {
    selectPane: noop, selectAdjacentPane: noop, setView: noop, toggleView: noop, focusInput: noop, scrollPage: noop,
    openNewSession: noop, openNewTab: noop, openTerminalTab: async () => {}, openPalette: noop, agentStarted: noop,
    openFind: noop, openSettings: noop, openAddPc: noop, toggleSidebar: noop, toggleTheme: noop,
    lock: null, enableNotifications: null, refresh: noop, openFiles: null, splitPane: null, zoomPane: null,
  };
  return <MachineContext.Provider value="local">
    <main style={{ padding: 16 }}>
      <h1>Fictional Back fixture</h1><output data-testid="pane">{pane}</output>
      <input aria-label="Fictional draft" defaultValue="preserved draft" />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setFiles(true)}>Open Files</button>
        <button onClick={() => setConfirm(true)}>Open confirmation</button>
        <button onClick={() => setNewSession(true)}>Open New workspace</button>
        <button ref={anchor} onClick={() => setMenu(true)}>Open menu</button>
        <button onClick={() => { setSettings(true); setLevel(1); }}>Open Settings steps</button>
        <button onClick={() => setRealSettings(true)}>Open actual Settings</button>
      </div>
    </main>
    <SettingsDialog open={realSettings} linkPage="appearance" actions={actions} updates={updates} auth={null} herdrVersion="fictional"
      onClose={() => setRealSettings(false)} onUsageLogin={noop} onEnableNotifications={async () => false} saveError={null} />
    {settings && <section className="modal" role="dialog" aria-label="Fixture Settings" style={{ position: "fixed", inset: "15%", zIndex: 30 }}>
      <h2>Fictional Settings controller</h2><output data-testid="settings-level">{level}</output>
      <button onClick={() => setLevel(2)}>Appearance step</button>
      <button onClick={() => setConfirm(true)}>Nested confirmation</button>
      <button onClick={() => setSettings(false)}>Close Settings steps</button>
    </section>}
    {files && <FilesDialog start="/fictional" paneId="fictional-pane" viewing={file.viewing !== null || diff.viewing !== null}
      onOpenFile={openFile} onOpenDiff={(comparison, changed) => diff.openDiff({ ...comparison, path: changed.path, oldPath: changed.old_path, directory: "/fictional", machineId: "local", paneId: "fictional-pane" })}
      onBrowseFolders={() => {}} onClose={() => setFiles(false)} />}
    {diff.viewing && <RepoDiffViewer target={diff.viewing} onClose={diff.closeDiff} onOpenFile={openFile} />}
    {file.viewing && <FileViewer path={file.viewing.path} paneId={file.viewing.paneId} onClose={file.closeFile} />}
    {menu && anchor.current && <RowMenu anchor={anchor.current} title="Fictional menu" items={[{ id: "confirm", label: "Nested confirmation", icon: MoreHorizontal, run: () => setConfirm(true) }]} onClose={() => setMenu(false)} />}
    <NewSessionDialog open={newSession} defaultCwd="/fictional" onClose={() => setNewSession(false)} onCreated={() => setNewSession(false)} />
    {confirm && <ConfirmDialog title="Fictional confirmation" body="No native action is possible." confirmLabel="Hold fictional action"
      onConfirm={() => new Promise<void>((_done, reject) => { refuse.current = reject; })} onClose={() => setConfirm(false)} />}
  </MachineContext.Provider>;
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<SettingsProvider><Fixture /></SettingsProvider>);
