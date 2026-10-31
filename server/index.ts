import { handleWorkspaceRequest } from "./workspace-routes.ts";
import { closeMention, createSubmitText, freeClaudeBox, freeHermesInput, InputDraftError, pendingFault, pendingIdentity, pendingText } from "./core/composer.ts";
import { createInputLane } from "./core/input.ts";
import { type Client, connectionData, connectionOf, createConnections, presenceOf, send, type SocketData } from "./core/connections.ts";
import { createStatusHub } from "./core/status.ts";
import { ATTACH_HELD_MESSAGE, ATTACH_HELD_RETRY_MS, ATTACH_HOLD_MS, ATTACH_RELOOKUP_FOR_MS, ATTACH_RETRY_FOR_MS } from "./core/terminal-process.ts";
import { createTerminalRegistry, type TerminalSighting, validGeometry } from "./core/terminals.ts";
import { handlePaneRequest, paneContext } from "./pane-routes.ts";
import { randomBytes } from "node:crypto";
import { readHerdrProfiles, type HerdrMachineProfile } from "./herdr-profiles.ts";
import { accessSync, constants, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ServerWebSocket } from "bun";

import type { AgentKind, ClientMessage, HealthAuth, HerdrPane, IntegrationsResponse, PanePlan, PendingMessage, PluginActionsResponse, ProjectFavicon, ServerFeature } from "../shared/protocol.ts";
import { DEFAULT_PORT } from "../shared/protocol.ts";
import { DEVICE_COOKIE, authClient, bearerMatches, handleAuthRequest, isAuthenticated, isSecureRequest, parseCookies, presentedToken, presentedTokenHeld, recordPresentedTokenFailure, requiresAuth, unauthorizedJson } from "./auth.ts";
import { cameThroughProxy, decideAccess, isLoopbackAddress, isLoopbackBind, isServeOwnerRequest, lanExposed } from "./access.ts";
import { DeviceStore, handleDeviceRequest, type DeviceMatch } from "./devices.ts";
import { handlePreferencesRequest, PreferenceStore } from "./preferences.ts";
import { readHostBattery } from "./host-battery.ts";
import { remoteAccess, TailnetIdentitySource } from "./tailscale.ts";
import { badRequest, errorResponse, jsonResponse, readJsonObject } from "./http.ts";
import { requestOrigin, serveStatic } from "./static.ts";
import { compressResponse } from "./compress.ts";
import { isMouseReport, typingGuards } from "./input-guard.ts";
import { claudePaneSession } from "./conversation.ts";
import { processAlive } from "./omo-status.ts";
import { omoRuns, omoTasks } from "./omo-tasks.ts";
import { claudeSubagents, within } from "./claude-subagents.ts";
import { piParentForPane, readPiActivity } from "./pi-subagents.ts";
import { piSubagentResponse } from "./pi-subagent-routes.ts";
import { SHELL_AGENTS, shellAgentExecutable } from "./shell-agent.ts";
import { claudeForegroundSession, claudeSessionTempDir } from "./claude-store.ts";
import { fileResponse, findFile, crossSiteFileRead, forgetPageMedia, pageMediaResponse, pageMediaSource, PAGE_MEDIA_PATH } from "./file-view.ts";
import { findProjectFavicon } from "./project-favicon.ts";
import {
  agentManifests,
  HerdrError,
  herdrSocketPath,
  integrationList,
  paneGet,
  paneProcessInfo,
  paneRead,
  paneSendKeys,
  paneSendText,
  ping,
  pluginActionInvoke,
  pluginActionList,
  pluginList,
  pluginLogList,
  type PluginInvocationContext,
  sessionSnapshot,
} from "./herdr/client.ts";
import { type AlertTiming, defaultStateDir, handlePushRequest } from "./push.ts";
import { claudeHeldIsGrey, shownInputBox, codexQuestionsCollapsed, handlePromptRequest, isClaudeHeld, heldCandidate, modelListWaits, noteSubmitted, parseInteractivePrompt } from "./prompt.ts";
import { secretPrompt, validSecret } from "../shared/secret-prompt.ts";
import { attachableIdentity, sidecarAvailable } from "./pty/sidecar.ts";
import { mirrorInput } from "./mirror-input.ts";
import { PendingInputs, samePendingIdentity, type PendingIdentity, type PendingRecord } from "./pending-input.ts";
import { processStartedAt } from "./process-start.ts";
import { PendingRequestBook } from "./pending-requests.ts";
import { LettaStops, type LettaStopTicket } from "./letta-stop.ts";
import { interruptCodexSteering } from "./codex-steering.ts";
import { OUTPUT_HARD_BYTES } from "./output-window.ts";
import { connectUpdater, handleUpdateRequest, type UpdateService } from "./update-api.ts";
import { handleHerdrUpdateRequest, HerdrUpdater } from "./herdr-update.ts";
import { handlePortalRequest, PortalService } from "./portal.ts";
import { handleTelemetryRequest, Telemetry } from "./telemetry.ts";
import { handleUsageRequest, UsageService } from "./usage.ts";
import { CLIProxyService } from "./cliproxy.ts";
import { CLIProxyRoutes } from "./cliproxy-routes.ts";
import { UsageLoginService } from "./usage-login.ts";
import { handleVoiceRequest, VoiceService } from "./voice.ts";

import { forkCapabilityGate, forkRequestGate, type ForkPolicy } from "./fork-policy.ts";
import { BRIDGE_PROTOCOL } from "../shared/machines.ts";
import { bridgeIdentity, registerBridge } from "./bridge.ts";
import { handleMachineRequest } from "./machine-api.ts";
import { HerdrSidebarConfig, herdrConfigPath } from "./herdr-sidebar.ts";
import { MachineRelay } from "./machine-relay.ts";
import { sameOrigin } from "./machine-security.ts";
import { PLUGIN_LOG_LIMIT, pluginActionResult, pluginLogEntry, pluginPaneContext, waitForPluginAction } from "./plugin-actions.ts";

/** How herdr's plugin manifests name the platform this server (and so its herdr) runs on. */
const PLUGIN_PLATFORM = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
/** How long POST /api/plugin/action waits for the command herdr started to end before it answers `running`. */
const PLUGIN_ACTION_WAIT_MS = 5_000;
const livePaneIds = async (timeoutMs?: number): Promise<string[]> => (await sessionSnapshot(undefined, timeoutMs)).panes.map((pane) => pane.pane_id);
/** The gap between a composer message's text and its Enter (see submitText). */
export const SUBMIT_DELAY_MS = 120;
/**
 * herdr holds a lone ESC typed through the attach pty ~150ms (measured) to tell it from
 * an Alt+key: a composer message waits this long after the pane's last keystroke, so a
 * Stop tapped just before Send still reaches the pane first.
 */
const TYPED_SETTLE_MS = 300;
/**
 * A terminal key (WS `keys`) goes through herdr's RPC, around the attach pty: it waits this long
 * after the pane's last pty keystroke so it never overtakes typing on its way through the
 * sidecar and the attach, and the whole TYPED_SETTLE_MS when that keystroke ended in an ESC
 * herdr may still be holding. Short enough that a held arrow between typed letters shows no lag.
 */
const KEY_SETTLE_MS = 40;
/** Keys that may wait to join one `pane.send_keys` while herdr answers the one before (a held arrow repeats ~30/s). */
const MAX_WAITING_KEYS = 256;
/**
 * Nothing of a composer message is typed once this long has passed since it reached the
 * server (it can wait behind a stalled one in the pane's queue): it answers submit_timeout
 * instead. A send that starts in time ends within two more 10s RPCs, before the client
 * stops waiting (SUBMIT_TIMEOUT_MS in src/lib/ws.ts), so a message it gave up on never
 * reaches the pane later.
 */
export const SUBMIT_DEADLINE_MS = 45_000;
/** How long a cleared Claude input box may take to read empty before the send is refused after all. */
const DRAFT_CLEAR_WAIT_MS = 1_500;
const DRAFT_CLEAR_POLL_MS = 50;

const SERVER_FEATURES: ServerFeature[] = ["submit", "pending-input", "pending-hold", "secret-input", "input-ready", "take-over", "watch", "conversation-watch", "ping"];


const AGENT_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  omp: "Oh My Pi",
  omo: "OmO",
  gjc: "Gajae Code",
  pi: "pi",
  gemini: "Gemini CLI",
  cursor: "Cursor",
  opencode: "OpenCode",
  copilot: "GitHub Copilot",
  kimi: "Kimi",
  amp: "Amp",
};

/** The temp folder of the Claude Code session in a pane, or null when the pane runs none or it has none. */
async function claudeTempFolder(paneId: string): Promise<string | null> {
  try {
    const pane = await paneGet(paneId);
    if ((pane.agent ?? pane.agent_session?.agent) !== "claude") return null;
    const session = await claudePaneSession(pane);
    return session === null ? null : await claudeSessionTempDir(session.path);
  } catch { return null; /* herdr busy or the pane gone: the path stays not found */ }
}

/**
 * What Bun.serve admits before a route runs (64 MiB). The ~55.9 MB body of a 40 MiB file is under it,
 * so the attachment route answers it with its JSON reason. The browser refuses a file over
 * MAX_ATTACHMENT_BYTES before it uploads (src/lib/api.ts), so only a non-browser client that sends
 * more than this can still see Bun's own empty 413.
 */
const BUN_BODY_CEILING = 64 * 1024 * 1024;

export interface ServerInstance {
  port: number;
  hostname: string;
  statusReady: Promise<void>;
  alertsSettled: () => Promise<void>;
  stop: () => void;
}

export function createServer(
  options: {
    port?: number;
    hostname?: string;
    token?: string;
    /** where VAPID keys and push subscriptions persist; tests pass a temp dir */
    stateDir?: string;
    /** the PC's own Tailscale login, for the identity check; tests set it, otherwise `tailscale status` says */
    tailscaleOwner?: string | null;
    /** the operator declares `tailscale serve` as this install's only ingress; HERDR_WEB_TAILSCALE_SERVE_ONLY=1 says the same */
    tailscaleServeOnly?: boolean;
    /** the tailnet identity behind the access check; unset, the tailscale CLI says. Tests pass one with their own status reader. */
    tailnet?: TailnetIdentitySource;
    /** Native Codex store; defaults to CODEX_HOME. Tests use an isolated store. */
    codexHome?: string;
    grokHome?: string;
    /** Server-private Letta store root; tests inject an isolated temporary store. */
    lettaRoot?: string;
    /** OpenCode's database; defaults to where OpenCode finds it (OPENCODE_DB, XDG_DATA_HOME). Tests use an isolated store. */
    opencodeDb?: string;
    /** Native Devin store; tests pass an isolated SQLite database. */
    devinDbPath?: string;
    /** Native Hermes store; pane process HERMES_HOME wins when this is unset. Tests use an isolated store. */
    hermesHome?: string;
    updates?: UpdateService;
    /** updates herdr itself (server/herdr-update.ts); unset, the app offers no herdr update. Tests pass one that runs a stand-in herdr. */
    herdrUpdate?: HerdrUpdater;
    /** a public address through Portal (server/portal.ts); unset, the app offers none. Tests pass one that runs a stand-in portal. */
    portal?: PortalService;
    /** anonymous install and update counts (server/telemetry.ts); unset, the server sends none and answers 404. Only the real entrypoint passes one. */
    telemetry?: Telemetry;
    /** plan limits of the AI subscriptions signed in here; tests pass one without real sign-ins */
    usage?: UsageService;
    /** Tests supply an isolated proxy service, never a user's configured instance. */
    cliProxy?: CLIProxyService;
    /** Tests use a disposable credential home and stand-in CLI binaries. */
    usageLogin?: UsageLoginService;
    /** voice input's key, provider and models; tests pass one with their own env and fetch */
    voice?: VoiceService;
    machines?: boolean;
    /** Read-only saved profiles from the local herdr client; tests supply their own catalog. */
    herdrProfiles?: () => Promise<HerdrMachineProfile[]>;
    /** herdr's config.toml, for its sidebar rows (server/herdr-sidebar.ts); unset, where herdr itself reads it. Tests pass a temp file. */
    herdrConfigPath?: string;
    registerBridge?: boolean;
    /** Fork launcher only: strict ingress and explicit external-side-effect fences. */
    forkPolicy?: ForkPolicy;
    remoteOperations?: boolean;
    /** PLUGIN_ACTION_WAIT_MS; a test shortens it to see a run that outlasts the wait */
    pluginActionWaitMs?: number;
    /** SUBMIT_DEADLINE_MS; tests shorten it */
    submitDeadlineMs?: number;
    /** SUBMIT_DELAY_MS; a test lengthens it to hold a second message behind the first */
    submitDelayMs?: number;
    /** How long a queued send waits for a confirmed new turn to start; tests shorten it. */
    pendingStartTimeoutMs?: number;
    /** how long a push alert waits for the pane to change first (server/push.ts); tests send at once */
    alertTiming?: Partial<AlertTiming>;
    /** accept plain-http loopback push endpoints (server/push.ts); only tests delivering to push.fake.ts set it */
    pushLoopbackHttp?: boolean;
    /** how long a turn's end is held for its background work (server/background-wait.ts); tests shorten it */
    backgroundWait?: { grace: number; limit: number };
    /** Clock for background holds and alert turn durations; tests advance it explicitly. */
    statusNow?: () => number;
    /** ATTACH_RETRY_FOR_MS; tests shorten it */
    attachRetryForMs?: number;
    /** ATTACH_HELD_RETRY_MS; tests shorten it */
    attachHeldRetryMs?: number;
    /** ATTACH_RELOOKUP_FOR_MS; tests shorten it */
    attachRelookupForMs?: number;
    /** ATTACH_HOLD_MS; a test lengthens it so an attach's exit always comes before its hold ends */
    attachHoldMs?: number;
    /** whether herdr can `terminal attach`; unset, its ping says, and this runtime's PTY sidecar has to be runnable. Tests give a Windows herdr's answer, at once or as late as a ping's. */
    terminalAttach?: boolean | (() => Promise<boolean>);
    /** whether this runtime can run the PTY sidecar; unset, server/pty/sidecar.ts says. Tests give a runtime without Node or node-pty, while herdr keeps its own answer. */
    sidecar?: boolean;
  } = {},
): ServerInstance {
  /** whether this bridge can `terminal attach`: herdr is asked once, and the PTY sidecar has to be runnable here (server/pty/sidecar.ts) */
  /** whether the sidecar can run, settled as the server starts so that attach, /api/health and /api/bridge tell one answer; a forced answer (tests) stands in for it */
  const sidecar = options.sidecar ?? (options.terminalAttach === undefined ? sidecarAvailable() : options.terminalAttach !== false);
  let terminalAttachKnown: boolean | null = typeof options.terminalAttach === "boolean" ? options.terminalAttach : null;
  const terminalAttach = async (): Promise<boolean> => {
    if (terminalAttachKnown === null) {
      terminalAttachKnown = typeof options.terminalAttach === "function" ? await options.terminalAttach() : attachableIdentity(await ping(), sidecar).terminal_attach !== false;
    }
    return terminalAttachKnown;
  };
  const retryFor = options.attachRetryForMs ?? ATTACH_RETRY_FOR_MS;
  const heldRetry = options.attachHeldRetryMs ?? ATTACH_HELD_RETRY_MS;
  const relookupFor = options.attachRelookupForMs ?? ATTACH_RELOOKUP_FOR_MS;
  const holdFor = options.attachHoldMs ?? ATTACH_HOLD_MS;
  const clients = new Set<Client>();
  /** connections whose page is in use (`presence`), relayed ones included: while any is, no web push goes out */
  const present = new Set<Client>();
  type PendingLease = { sighting: TerminalSighting; authority: object };
  const pendingAuthorities = new WeakMap<Client, Map<string, object>>();
  type PendingItem = PendingRecord<Client, PendingLease>;
  const lettaStops = new LettaStops<Client, PendingLease>();
  const pending = new PendingInputs<Client, PendingLease>((owner, paneId, messages, removed) => {
    send(owner, { type: "pending-messages", pane_id: paneId, messages, ...(removed ? { removed } : {}) });
  }, Date.now, options.pendingStartTimeoutMs);
  const pendingDrains = new Set<string>();
  type SubmitReply = { ok: boolean; pending?: PendingMessage; code?: string; message?: string };
  const pendingRequests = new WeakMap<Client, PendingRequestBook<SubmitReply>>();
  // the last input_draft refusal per pane: its named draft (Clear it and send), or none (Send anyway)
  const draftConfirmations = new WeakMap<Client, Map<string, { draft: string | null; identity: PendingIdentity; box?: string | null }>>();
  let stopped = false;
  const { attachments, conversations, reconcileOutput, closeAttachment, detachClaimed, dropClaims, sight, poke, drainOutput, terminalFrames } = createTerminalRegistry({ options, clients, stopped: () => stopped, terminalAttach, holdFor, heldRetry, retryFor, relookupFor, holdPending, holdPendingPane, end: (client, reason) => end(client, reason), onOutput: (paneId) => lettaStops.output(paneId) });

  const { serialize, settleAfterTyping, paneQueues, lastTyped, typedEscape } = createInputLane({ TYPED_SETTLE_MS, KEY_SETTLE_MS });
  /** per pane, the WS keys still waiting at the tail of the pane's queue: later keys of the same sender join them */
  const waitingKeys = new Map<string, { keys: string[]; client: unknown; origin: unknown; pty: unknown; claim: unknown; roles: number; run: Promise<unknown> | null; sent: boolean }>();
  const hostname = options.hostname ?? process.env["HOST"] ?? "127.0.0.1";
  /** Empty token = gate disabled; every route then behaves exactly as it did before auth existed. */
  const token = options.token ?? process.env["HERDR_WEB_TOKEN"] ?? "";
  /** paired devices (server/devices.ts) and the PC's Tailscale login: the two ways in besides the token and this PC itself */
  const devices = new DeviceStore(options.stateDir ?? defaultStateDir());
  const preferences = new PreferenceStore(options.stateDir ?? defaultStateDir());
  const herdrSidebar = new HerdrSidebarConfig(options.herdrConfigPath ?? herdrConfigPath());
  const cliProxy = options.cliProxy ?? new CLIProxyService(options.stateDir ?? defaultStateDir());
  const cliProxyRoutes = new CLIProxyRoutes(cliProxy);
  const usageLogin = options.usageLogin ?? new UsageLoginService();
  const usage = options.usage ?? new UsageService(undefined, undefined, (refresh) => cliProxy.report(refresh));
  const voice = options.voice ?? new VoiceService({ stateDir: options.stateDir ?? defaultStateDir(), env: process.env, fetch });
  /** a login named here is taken as it is: a tagged node has none of its own to read (HERDR_WEB_TAILSCALE_OWNER) */
  const namedOwner = options.tailscaleOwner !== undefined ? options.tailscaleOwner : process.env["HERDR_WEB_TAILSCALE_OWNER"]?.trim() || undefined;
  const tailnet = options.tailnet ?? new TailnetIdentitySource();
  const identityOf = async (grantPath: boolean, host: string | null) => {
    if (namedOwner !== undefined) return { ...(grantPath ? await tailnet.freshIdentity(host) : { soleLogin: null, dnsName: null, tailnetIp: null }), owner: namedOwner, tagged: false };
    return grantPath ? tailnet.freshIdentity(host) : tailnet.identity();
  };
  identityOf(false, null);
  const serveOnly = options.tailscaleServeOnly ?? process.env["HERDR_WEB_TAILSCALE_SERVE_ONLY"] === "1";

  const submitText = createSubmitText({ options, lastTyped, attachments, terminalAttach, SUBMIT_DEADLINE_MS, TYPED_SETTLE_MS, DRAFT_CLEAR_WAIT_MS, DRAFT_CLEAR_POLL_MS, SUBMIT_DELAY_MS });

  const { mayType, authorizeSocket, admit, setRole, watchPane, unwatchPane, killWatches, end } = createConnections({ clients, present, pending, devices, detachClaimed, dropClaims });

  function pendingLease(owner: Client, paneId: string): PendingLease {
    const sighting = sight(owner, paneId);
    if (!sighting.facts().attached) throw new HerdrError("input_not_ready", "The pane is not attached and ready");
    let authorities = pendingAuthorities.get(owner);
    if (!authorities) { authorities = new Map(); pendingAuthorities.set(owner, authorities); }
    let authority = authorities.get(paneId);
    if (!authority) { authority = {}; authorities.set(paneId, authority); }
    const lease = { sighting, authority };
    authorizePending(owner, paneId, lease);
    return lease;
  }
  // Losing authority cancels already-running checks too. Rejoining the same shared
  // attachment or returning to interact must never revive a captured lease.
  function holdPending(owner: Client, paneId?: string): void {
    lettaStops.ownerLeft(owner, paneId);
    if (paneId === undefined) pendingAuthorities.delete(owner);
    else pendingAuthorities.get(owner)?.delete(paneId);
    pending.hold(owner, paneId);
  }
  function holdPendingPane(paneId: string, fault: { code: string; message: string }): void {
    lettaStops.invalidate(paneId);
    for (const owner of clients) pendingAuthorities.get(owner)?.delete(paneId);
    pending.holdPane(paneId, fault);
  }
  function authorizePending(owner: Client, paneId: string, lease: PendingLease): void {
    authorizeSocket(owner);
    if (!clients.has(owner) || connectionOf(owner).closing) throw new HerdrError("disconnected", "The pending message's connection closed");
    if (pendingAuthorities.get(owner)?.get(paneId) !== lease.authority) throw new HerdrError("pending_lease_lost", "The pending message's authority changed; review it before sending again");
    const facts = lease.sighting.facts();
    if (facts.currentHeld) throw new HerdrError("attach_held", ATTACH_HELD_MESSAGE);
    if (!typingGuards.pendingLease(facts)) throw new HerdrError("input_not_ready", "The pending message's pane connection changed");
  }
  async function pendingContext(owner: Client, paneId: string, lease: PendingLease, identity?: PendingIdentity, pasted = false): Promise<{ pane: HerdrPane; identity: PendingIdentity; working: boolean; screen: string }> {
    authorizePending(owner, paneId, lease);
    // The same normalized snapshot the client sees includes a known Codex finish that
    // herdr reports as unknown. Nothing is inferred from a bare unknown state.
    const pane = (await clientSnapshot()).panes.find((candidate) => candidate.pane_id === paneId);
    if (!pane) throw new HerdrError("pane_not_found", `pane ${paneId} not found`);
    const info = await paneProcessInfo(paneId);
    const pid = info?.foreground_processes?.[0]?.pid ?? null;
    const base = pendingIdentity(pane);
    const current: PendingIdentity = {
      ...base, processPid: pid, processBirth: pid === null ? null : processStartedAt(pid),
      omoSession: omo.sessionOf(paneId)?.sessionId ?? null,
      // Claude's own PID record says which session it runs, also without herdr's hook
      claudeSession: base.agent === "claude" ? await claudeForegroundSession(info?.foreground_processes ?? []) : null,
    };
    if (identity && !samePendingIdentity(identity, current)) {
      throw new HerdrError("pending_target_changed", "The pane's terminal or agent session changed; review the message before sending it again");
    }
    if (identity) {
      // Keep newly learned parts so a replacement before Enter is checked against them too.
      identity.session ??= current.session;
      identity.processPid ??= current.processPid;
      identity.processBirth ??= current.processBirth;
      identity.omoSession ??= current.omoSession;
      identity.claudeSession ??= current.claudeSession;
    }
    // the live screen, not the viewport: a pane scrolled into its history still draws its next
    // menu or password prompt at the bottom (server/prompt.ts liveScreen)
    const screen = (await paneRead({ paneId, source: "detection", format: "text" })).text;
    if (secretPrompt(screen, lease.sighting.facts().cols) !== null) {
      throw new HerdrError("agent_blocked", "The terminal is waiting for masked input; answer it with the secret-input form first");
    }
    const collapsed = current.agent === "codex" && codexQuestionsCollapsed(screen);
    // a message Claude Code holds for its invisible characters is a card to answer first, also once its hint has gone.
    // Not so with this delivery's own paste in the box (`pasted`), which the check before the paste found
    // free of a held message: the same words as the message noted before would be taken for that one,
    // and so would any paste under a hint left up from it (typing does not take Claude's hint down)
    const held = !pasted && current.agent === "claude" ? heldCandidate(paneId) : null;
    const prompt = current.agent ? parseInteractivePrompt(current.agent, screen, null, true, [], held) : null;
    // as the card's own reader decides it: Claude's grey text under a hint left behind is no held message
    const waits = prompt !== null && !(pasted && isClaudeHeld(prompt)) && !(await claudeHeldIsGrey(paneId, prompt));
    if (current.agent && (waits || modelListWaits(current.agent, screen) || (pane.agent_status === "blocked" && !collapsed))) {
      throw new HerdrError("agent_blocked", "The agent is waiting for an answer in the terminal");
    }
    if (current.agent && !["working", "idle", "done"].includes(pane.agent_status) && !collapsed) {
      throw new HerdrError("agent_not_ready", "The agent's current input state is not known");
    }
    authorizePending(owner, paneId, lease);
    return { pane, identity: current, working: current.agent !== null && (pane.agent_status === "working" || collapsed), screen };
  }
  /**
   * The live screen for claudeInputDraft, and the viewport's colors when viewportShowsLive verifies
   * they show it. Read last, the live screen holds anything typed meanwhile. An empty box (or none)
   * needs no colors.
   */

  async function dispatchPendingText(owner: Client, paneId: string, text: string, lease: PendingLease, identity: PendingIdentity,
    automatic: boolean, arrivedAt: number, committing: (working: boolean, restarting?: boolean) => void = () => {}, interruptWorkingCodex = false,
    recovery?: LettaStopTicket<Client, PendingLease>): Promise<SubmitReply> {
    let wrote = false;
    // what the checks below read is older than a status event that arrives while they run
    let mark = pending.mark(paneId);
    try {
      const typed = Date.now() - (lastTyped.get(paneId) ?? 0);
      if (typed < TYPED_SETTLE_MS) await Bun.sleep(TYPED_SETTLE_MS - typed);
      mark = pending.mark(paneId);
      let activity = recovery?.activity;
      let normalAfterStop = false;
      let normalGeneration = mark;
      const context = await pendingContext(owner, paneId, lease, identity);
      const recoveryReady = (current: typeof context, draft = "") => {
        if (!recovery) return;
        authorizePending(owner, paneId, recovery.lease);
        if (!recovery.lease.sighting.facts().sameClaim || recovery.activity !== activity
          || current.identity.processPid == null || current.identity.processBirth == null
          || !lettaStops.current(recovery) || recovery.identity.session !== current.identity.session
          || recovery.scope !== current.pane.tokens?.["letta_scope"]) {
          throw new HerdrError("pending_target_changed", "The stopped Letta terminal changed; check it before sending again");
        }
        // Real native readiness supersedes the compatibility witness, never the identity,
        // lease, prompt or uncertainty guards. A subsequent working turn cancels this send.
        if (["idle", "done"].includes(current.pane.agent_status)) {
          if (pending.mark(paneId) !== mark) throw new HerdrError("pending_wait", "The native state changed during the input check; try again");
          normalAfterStop = true;
          normalGeneration = mark;
          return;
        }
        if (normalAfterStop || !lettaStops.valid(recovery, { ...current, generation: pending.mark(paneId) }, draft)) {
          throw new HerdrError("pending_target_changed", "The stopped Letta terminal changed; check it before sending again");
        }
      };
      recoveryReady(context);
      if (recovery && !pending.interruptReview(paneId, true)) throw new HerdrError("pending_uncertain", "Check the earlier unconfirmed delivery in the terminal before sending again");
      if (automatic && context.working) {
        pending.observe(paneId, "working", mark);
        throw new HerdrError("pending_wait", "The agent is working again; this message still waits for its next turn");
      }
      // a draft typed in the terminal is the user's: the paste would join it and the Enter send both (#609).
      // The box is the live screen's; only the viewport read tells Claude's grey text from a draft. The live
      // read comes after the colors, so text typed between the two is in the box and holds the message.
      if (context.identity.agent === "claude") await freeClaudeBox(paneId, context.working, () => authorizePending(owner, paneId, lease), arrivedAt + (options.submitDeadlineMs ?? SUBMIT_DEADLINE_MS));
      else if (context.identity.agent === "hermes") await freeHermesInput(paneId, context.identity);
      if (Date.now() - arrivedAt > (options.submitDeadlineMs ?? SUBMIT_DEADLINE_MS)) throw new HerdrError("submit_timeout", "The pending message waited too long; nothing was typed");
      authorizePending(owner, paneId, lease);
      // asked again right before herdr is written to: its connect is awaited (#666)
      const allowed = (): boolean => {
        try {
          authorizePending(owner, paneId, lease);
          if (recovery) {
            authorizePending(owner, paneId, recovery.lease);
            if (!recovery.lease.sighting.facts().sameClaim || !lettaStops.current(recovery)
              || recovery.activity !== activity || pending.mark(paneId) !== (normalAfterStop ? normalGeneration : recovery.generation)) return false;
          }
          return true;
        } catch { return false; }
      };
      // Pending input is a guarded literal paste + Enter, never Codex's native Tab queue.
      // Keep the final key here so a disconnect, pane switch or new menu can cancel it.
      wrote = true;
      await paneSendText(paneId, `\u001b[200~${closeMention(text)}\u001b[201~`, undefined, allowed).catch((error: unknown) => {
        // a paste the guard refused was never written: the message is unsent, not uncertain
        if (error instanceof HerdrError && error.code === "cancelled") { wrote = false; authorizePending(owner, paneId, lease); }
        throw error;
      });
      await Bun.sleep(options.submitDelayMs ?? SUBMIT_DELAY_MS);
      activity = recovery?.activity;
      mark = pending.mark(paneId);
      const beforeEnter = await pendingContext(owner, paneId, lease, identity, true);
      recoveryReady(beforeEnter, closeMention(text).trimEnd());
      if (automatic && beforeEnter.working) throw new HerdrError("pending_wait", "The agent started another turn before this queued message could be committed");
      authorizePending(owner, paneId, lease);
      const steering = !automatic && beforeEnter.working && !recovery;
      committing(steering);
      // Claude Code queues what Enter commits during a turn; Ctrl+Enter sends it now (#737). herdr
      // encodes the key as the pane asked, and as a plain CR for a program that asked for nothing.
      await paneSendKeys(paneId, [steering && beforeEnter.identity.agent === "claude" ? "ctrl+enter" : "Enter"], undefined, allowed);
      // the status the panel was read under; a status event since (a finish, an approval) stales the Escape
      let statusAtRead = pending.current(paneId);
      await interruptCodexSteering(interruptWorkingCodex, closeMention(text), { agent: beforeEnter.identity.agent, working: beforeEnter.working, screen: beforeEnter.screen }, {
        read: async () => {
          const current = await pendingContext(owner, paneId, lease, identity, true);
          statusAtRead = pending.current(paneId);
          return { agent: current.identity.agent, working: current.working, screen: current.screen };
        },
        restarting: () => committing(true, true),
        // herdr has no compare-and-send: the screen can change between this read and the write, so the
        // write is refused when the lease, the deadline or the pane's status moved meanwhile
        escape: (fresh) => paneSendKeys(paneId, ["Escape"], undefined, () => allowed() && fresh() && pending.current(paneId) === statusAtRead),
      });
      noteSubmitted(paneId, text);
      return { ok: true };
    } catch (error) {
      const fault = wrote ? { code: "submit_changed", message: "Pending-message delivery could not be confirmed. Check the terminal before sending again." } : pendingFault(error);
      if (automatic && !wrote && fault.code === "agent_blocked") pending.observe(paneId, "blocked", mark);
      return { ok: false, ...fault };
    }
  }
  /** Observe only after our authenticated Stop write succeeded; never drain pending input. */
  async function observeLettaStop(ticket: LettaStopTicket<Client, PendingLease>): Promise<void> {
    try {
      while (lettaStops.current(ticket)) {
        // fixed wait: pace post-Stop native reads while the expiring ticket remains current; this delay grants no readiness.
        await Bun.sleep(150);
        authorizePending(ticket.owner, ticket.paneId, ticket.lease);
        if (!ticket.lease.sighting.facts().sameClaim) break;
        const activity = ticket.activity;
        const context = await pendingContext(ticket.owner, ticket.paneId, ticket.lease, { ...ticket.identity });
        if (pending.mark(ticket.paneId) !== ticket.generation) break;
        if (activity !== ticket.activity || !lettaStops.matches(ticket, { ...context, generation: pending.mark(ticket.paneId) })) continue;
        // fixed wait: separate matching native reads by a stability gap; any intervening output rejects arming.
        await Bun.sleep(150);
        if (activity !== ticket.activity) continue;
        const fresh = await pendingContext(ticket.owner, ticket.paneId, ticket.lease, { ...ticket.identity });
        if (activity === ticket.activity && lettaStops.arm(ticket, { ...fresh, generation: pending.mark(ticket.paneId) })) return;
      }
    } catch { /* A lost lease, approval or unknown state cannot authorize recovery. */ }
    lettaStops.forget(ticket);
  }

  async function dispatchLettaRecovery(owner: Client, paneId: string, text: string, arrivedAt: number): Promise<SubmitReply | null> {
    const waiting = lettaStops.waiting(owner, paneId);
    if (waiting) {
      // Only this explicit new request waits; no old row gains replay authority.
      const until = Math.min(arrivedAt + (options.submitDeadlineMs ?? SUBMIT_DEADLINE_MS), Date.now() + DRAFT_CLEAR_WAIT_MS);
      while (lettaStops.current(waiting) && waiting.phase === "waiting" && Date.now() < until) {
        authorizePending(owner, paneId, waiting.lease);
        if (!waiting.lease.sighting.facts().sameClaim) throw new HerdrError("pending_lease_lost", "The stopped terminal's claim changed");
        await Bun.sleep(50);
      }
    }
    const ticket = lettaStops.take(owner, paneId);
    if (!ticket) {
      if (waiting) lettaStops.forget(waiting);
      return waiting ? { ok: false, code: "input_not_ready", message: "Stop is still settling or the terminal changed. Check it, then send again; nothing was queued or typed." } : null;
    }
    try {
      authorizePending(owner, paneId, ticket.lease);
      return await dispatchPendingText(owner, paneId, pendingText(text), ticket.lease, { ...ticket.identity }, false, arrivedAt, undefined, false, ticket);
    } finally { lettaStops.forget(ticket); }
  }

  async function dispatchPending(item: PendingItem, automatic: boolean, arrivedAt: number, interruptWorkingCodex = false): Promise<SubmitReply> {
    const reply = await dispatchPendingText(item.owner, item.paneId, item.message.text, item.lease, item.identity,
      automatic, arrivedAt, (working, restarting) => pending.committing(item, working, restarting), interruptWorkingCodex);
    pending.settle(item, reply.ok ? undefined : { code: reply.code!, message: reply.message! }, reply.code === "submit_changed",
      automatic && ["pending_wait", "agent_blocked"].includes(reply.code ?? ""));
    return reply;
  }
  function drainPending(paneId: string): void {
    if (pendingDrains.has(paneId) || pending.next(paneId) === null) return;
    pendingDrains.add(paneId);
    const arrivedAt = Date.now();
    void serialize(paneId, async () => {
      const item = pending.next(paneId);
      if (item && pending.claim(item, true)) await dispatchPending(item, true, arrivedAt);
    }).catch((error) => console.warn("pending message:", pendingFault(error).code)).finally(() => {
      pendingDrains.delete(paneId);
      drainPending(paneId);
    });
  }
  function replayPendingOutcome(owner: Client, paneId: string, id: string): boolean {
    const outcome = pending.outcome(owner, paneId, id);
    if (!outcome) return false;
    send(owner, { type: "pending-messages", pane_id: paneId, messages: pending.list(owner, paneId), removed: [{ id, outcome }] });
    return true;
  }

  const { push, omo, gjc, claudeAgents, piAgents, plans, clientSnapshot, countVisit, machines, broadcastAll, logPushError, collector, waitTimer } = createStatusHub({ options, devices, clients, present, pending, drainPending, holdPendingPane, usage, usageLogin });
  const bridgeToken = randomBytes(32).toString("hex");

  type PortalStartup = { ok: true } | { ok: false; error: unknown };
  let settlePortalStartup!: (result: PortalStartup) => void;
  let portalStartupResult: PortalStartup | undefined;
  const portalStartup = new Promise<PortalStartup>((resolve) => {
    settlePortalStartup = (result) => {
      if (portalStartupResult !== undefined) return;
      portalStartupResult = result;
      resolve(result);
    };
  });

  const envPort = process.env["PORT"];
  const server = Bun.serve<SocketData>({
    port: options.port ?? (envPort ? Number(envPort) : DEFAULT_PORT),
    hostname,
    maxRequestBodySize: BUN_BODY_CEILING,

    async fetch(request, bunServer) {
      const startup = portalStartupResult ?? await portalStartup;
      if (!startup.ok) return compressResponse(request, errorResponse(startup.error));
      // the route's answer, gzipped for a browser that takes it (server/compress.ts)
      return compressResponse(request, await (async (): Promise<Response | undefined> => {
      const url = new URL(request.url);
      let { pathname } = url;
      if (options.forkPolicy) {
        const address = bunServer.requestIP(request);
        const denied = forkRequestGate(request, address !== null && isLoopbackAddress(address.address), options.forkPolicy);
        if (denied) return denied;
      }
      const bridgeAuthorized = isAuthenticated(request, bridgeToken);
      const bridgePath = pathname === "/api/bridge" || pathname === "/api/session" || pathname === "/api/agents" || pathname === "/api/agent/rename" || pathname === "/api/integrations" || pathname === "/api/plugins/actions" || pathname === "/api/plugin/action" || pathname.startsWith("/api/pane/") || pathname.startsWith("/api/workspace/") || pathname.startsWith("/api/worktree/") || pathname.startsWith("/api/tab/") || pathname === "/api/layout/ratio" || pathname.startsWith("/api/fs/") || pathname === "/ws";
      const ip = bunServer.requestIP(request);
      const loopback = ip !== null && isLoopbackAddress(ip.address);
      const forwarded = cameThroughProxy(request.headers);
      const funnel = request.headers.has("tailscale-funnel-request");
      const tailscaleLogin = request.headers.get("tailscale-user-login");
      const forwardedFor = request.headers.get("x-forwarded-for");
      const requestHost = request.headers.get("host");
      // the guessing budget of the address that asks (auth.ts): a token presented while it waits is not compared
      const client = authClient(ip?.address ?? null, request.headers);
      const presented = presentedToken(request, token, client);
      // counted at once, before any await below lets a concurrent guess pass the same check. Every
      // wrong token counts, a paired watch device's too (a right one would upgrade it to drive);
      // the connection server's own bridge token does not
      if (presented === "wrong" && !bridgeAuthorized) recordPresentedTokenFailure(client);
      const tokenMatched = presented === "match";
      let pairedDevice: DeviceMatch | null;
      try {
        pairedDevice = devices.match(parseCookies(request.headers.get("cookie")).get(DEVICE_COOKIE));
      } catch (error) {
        // First-cookie confirmation is an authorization write, not best-effort telemetry.
        return errorResponse(error);
      }
      const requestShape = { loopback, forwarded, funnel, tailscaleLogin, forwardedFor, serveOnly };
      const identity = await identityOf(token === "" && pairedDevice === null && isServeOwnerRequest(requestShape) && (pathname === "/ws" || pathname.startsWith("/api/")), requestHost);
      const access = decideAccess({
        ...requestShape,
        host: requestHost,
        tokenMatched,
        device: pairedDevice,
        ...identity,
        tokenConfigured: token !== "",
        gated: devices.gated,
      });
      const authenticated = access.level === "full" || (bridgePath && bridgeAuthorized);

      if (requiresAuth(pathname) && !authenticated) {
        // a script's Bearer guess is told to wait; a browser's cookie gets the usual 401 and its sign-in form
        if (presented === "held" && pathname !== "/ws" && request.headers.has("authorization")) return presentedTokenHeld(client);
        // The WS client never parses a body, so the upgrade refusal stays plain text.
        return pathname === "/ws" ? new Response("unauthorized", { status: 401 }) : unauthorizedJson(access.level === "none" ? access.reason : "token_required");
      }

      const readOnly = access.level === "full" && access.role === "watch";
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(request.method);
      if (pathname.startsWith("/api/") && mutating && !sameOrigin(request)) {
        return jsonResponse({ error: { code: "invalid_origin", message: "Use controls from this app" } }, 403);
      }
      // An empty segment ("//") reads as another route to the checks below, while the PC proxy
      // drops it before forwarding: `/api/machines/<id>//fs/file` would pass as not a file read.
      if (pathname.startsWith("/api/") && pathname.includes("//")) return jsonResponse({ error: { code: "not_found", message: "not found" } }, 404);
      // What a watching device must not reach, spelled out rather than inferred from the
      // method: file contents (those files include credentials) and a directory listing
      // (names and sizes are the shape of a repository the terminals never print), plus
      // every mutation except the two below.
      const fileRead = /^\/api\/(?:machines\/[^/]+\/)?fs\//.test(pathname);
      const directoryListing = /^\/api\/(?:machines\/[^/]+\/)?workspace\/directories$/.test(pathname);
      // Signing a device's own alerts in is a preference of that device, so `watch` keeps
      // it. The endpoint it registers is https-only (server/push.ts), and that is the
      // protection: a watch device's subscription is delivered every status change anyway.
      // /api/push/test stays with a session that can drive only because it is a mutation.
      const ownPreferences = pathname === "/api/auth" || pathname === "/api/push/subscribe";
      // a repository's changes are file contents too: the patch of a credential file is that file
      const repositoryDiff = /^\/api\/(?:machines\/[^/]+\/)?workspace\/diff\//.test(pathname);
      if (readOnly && (fileRead || directoryListing || repositoryDiff || mutating && !ownPreferences)) {
        return jsonResponse({ error: { code: "read_only", message: "this device can only watch" } }, 403);
      }

      if (options.forkPolicy) {
        // Retired browser controllers may not write through the new source-native protocol.
        if (
          [
            "/api/action",
            "/api/snapshot",
            "/api/events",
            "/api/terminal",
            "/api/terminal/control",
          ].includes(pathname)
        ) {
          return jsonResponse(
            {
              error: {
                code: "reload_required",
                message:
                  "This application was upgraded. Reload before continuing; stored drafts are unchanged.",
              },
            },
            410,
          );
        }
        const capabilityResponse = forkCapabilityGate(
          request,
          !!options.telemetry,
        );
        if (capabilityResponse) return capabilityResponse;
      }

      if (pathname === "/api/bridge") {
        if (token === "" && !bridgeAuthorized) return unauthorizedJson();
        try { return jsonResponse(await bridgeIdentity(sidecar)); } catch (error) { return errorResponse(error); }
      }
      if (pathname === "/api/machines" || pathname.startsWith("/api/machines/")) {
        if (!machines) return jsonResponse({ error: { code: "bridge_only", message: "Manage PCs on the connection server" } }, 404);
        // /local aliases preserve every existing endpoint without a self-proxy.
        if (pathname.startsWith("/api/machines/local/")) {
          if (!sameOrigin(request) || (request.method !== "GET" && request.headers.get("x-herdr-machine") !== "1")) return jsonResponse({ error: { code: "invalid_origin", message: "Use PC controls from this app" } }, 403);
          pathname = pathname.replace("/api/machines/local/", "/api/");
          if (!/^\/api\/(session|agents|integrations|pane\/|workspace\/|worktree\/|tab\/|layout\/ratio$|agent\/rename$|plugins\/actions$|plugin\/action$)/.test(pathname)) return badRequest("invalid_route", "Unknown PC endpoint");
          url.pathname = pathname;
        } else {
          // a worktree made with an agent waits on git and then agent.start, up to 150 s on the PC
          bunServer.timeout(request, pathname === "/api/machines/events" ? 0 : pathname.endsWith("/worktree/create") ? 180 : 80);
          const deviceId = access.level === "full" ? access.device?.id : undefined;
          const response = await handleMachineRequest(request, machines, deviceId ? (close) => devices.onRevoke(deviceId, close) : undefined, preferences, readOnly, herdrSidebar);
          response.headers.set("cache-control", "no-store");
          return response;
        }
      }
      // Chat reads can chain several valid 10 s RPCs. Leave the 15/30 s client deadline
      // in charge rather than Bun's default 10 s idle cutoff. PC proxies have their own budget above.
      if (pathname === "/api/pane/read" || pathname === "/api/pane/conversation") bunServer.timeout(request, 60);
      if (pathname === "/ws") {
        if (!sameOrigin(request)) return new Response("invalid origin", { status: 403 });
        const deviceId = access.level === "full" ? access.device?.id : undefined;
        const machineId = url.searchParams.get("machine_id");
        if (machineId && machineId !== "local") {
          if (access.level === "none") return unauthorizedJson(access.reason);
          if (!machines?.endpoint(machineId)) return jsonResponse({ error: { code: "machine_offline", message: "This PC is disconnected" } }, 503);
          let relay: MachineRelay | undefined;
          try {
            relay = new MachineRelay(machines, machineId, readOnly);
            await relay.ready;
            const upgraded = bunServer.upgrade(request, { data: connectionData({ relay, deviceId, readOnly }) });
            if (upgraded) return undefined as unknown as Response;
            relay.close();
          } catch { relay?.close(); return new Response("remote websocket unavailable", { status: 502 }); }
          return new Response("websocket upgrade required", { status: 426 });
        }
        const upgraded = bunServer.upgrade(request, { data: connectionData({ deviceId, readOnly }) });
        if (upgraded) return undefined as unknown as Response;
        return new Response("websocket upgrade required", { status: 426 });
      }

      if (pathname === "/api/auth") {
        // signing out also ends the page media this browser was given (by its device, else by its address)
        // a browser can hold the token and a device cookie at once, and its renders are then the
        // client's: signing out ends both kinds
        if (request.method === "DELETE" && authenticated) {
          if (pairedDevice !== null) forgetPageMedia({ device: pairedDevice.id });
          forgetPageMedia({ client });
        }
        return handleAuthRequest(request, token, client);
      }
      if (pathname === "/api/devices" || pathname.startsWith("/api/devices/")) {
        try {
          const response = await handleDeviceRequest(request, pathname, devices, access);
          if (request.method === "DELETE" && response.status === 204) {
            // The device registry is the delivery authority even if cleaning the push file fails.
            try { push.revokeDevice(pathname.slice("/api/devices/".length)); } catch (error) { logPushError(error); }
            // and every page media address its renders were given
            forgetPageMedia({ device: pathname.slice("/api/devices/".length) });
          }
          return response;
        } catch (error) { return errorResponse(error); }
      }

      if (pathname === "/api/updates" || pathname.startsWith("/api/updates/")) {
        return handleUpdateRequest(request, pathname, options.updates);
      }
      if (pathname === "/api/herdr/update") return handleHerdrUpdateRequest(request, options.herdrUpdate);
      if (pathname === "/api/portal" || pathname.startsWith("/api/portal/")) {
        return handlePortalRequest(request, pathname, options.portal, { port: bunServer.port ?? DEFAULT_PORT, tokenSet: token !== "", serveOnly });
      }
      if (pathname === "/api/telemetry") return handleTelemetryRequest(request, options.telemetry);
      // what every browser of this server shares; a watching device reads it and cannot change it (above)
      if (pathname === "/api/preferences") return handlePreferencesRequest(request, preferences);
      if (pathname === "/api/host-battery") {
        if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
        return jsonResponse(await readHostBattery(), 200, { "Cache-Control": "no-store" });
      }

      if (pathname === "/api/usage") return handleUsageRequest(request, url, usage);
      if (pathname === "/api/usage/login") { bunServer.timeout(request, 30); return usageLogin.handle(request, collector.trackPane); }
      if (pathname === "/api/cliproxy" || pathname.startsWith("/api/cliproxy/")) { bunServer.timeout(request, 60); return cliProxyRoutes.handle(request); }
      // a long clip can keep the provider silent past Bun's 10 s idle limit before the first line
      if (pathname === "/api/voice" || pathname.startsWith("/api/voice/")) { bunServer.timeout(request, 120); return handleVoiceRequest(request, pathname, voice); }

      if (pathname === "/api/push" || pathname.startsWith("/api/push/")) {
        try {
          // a paired device owns its alerts; the open LAN (before any pairing) owns them only while
          // it stays open, like a subscription from before owners (undefined); a local/token/
          // Tailscale sign-in is the owner (null)
          const owner = access.level !== "full" ? null : access.device?.id ?? (access.via === "open" ? undefined : null);
          const answered = await handlePushRequest(request, pathname, push, owner);
          if (answered) return answered;
        } catch (error) {
          return errorResponse(error);
        }
      }

      if (pathname === "/api/health") {
        const auth: HealthAuth = access.level === "full"
          ? { required: false, authenticated: true, via: access.via, role: access.role, ...(access.via === "token" && bearerMatches(request, token) ? { bearer: true as const } : {}) }
          : { required: true, authenticated, ...(authenticated ? {} : { reason: access.reason }) };
        // this server is open to the network with no token and nothing paired, told to a client
        // that got in and to nobody else: naming it to an anonymous caller would be
        // reconnaissance, not help. Nothing here changes who is let in (server/access.ts).
        const lan_exposure = access.level === "full" && lanExposed({ hostname, tokenConfigured: token !== "", gated: devices.gated })
          ? { host: hostname } : undefined;
        if (url.searchParams.get("scope") === "bridge") return jsonResponse({ ok: true, auth, bridge_protocol: BRIDGE_PROTOCOL });
        try {
          const info = await ping();
          // a forced answer (tests) and a runtime without the PTY sidecar are told the way a Windows herdr's own would be
          const herdr = attachableIdentity(info, sidecar);
          return jsonResponse({ ok: true, herdr, auth, ...(lan_exposure ? { lan_exposure } : {}),
            web_ui: { boot_id: process.env["HERDR_WEB_BOOT_ID"] ?? null, revision: process.env["HERDR_WEB_REVISION"] ?? null } });
        } catch (error) {
          return errorResponse(error);
        }
      }

      if (pathname === "/api/access") {
        if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
        return jsonResponse(await remoteAccess(bunServer.port ?? DEFAULT_PORT), 200, { "cache-control": "no-store" });
      }

      if (pathname === "/api/session") {
        try {
          return jsonResponse({ snapshot: await clientSnapshot() });
        } catch (error) {
          return errorResponse(error);
        }
      }

      if (pathname === "/api/agents") {
        if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
        try {
          const kinds = new Set((await agentManifests()).manifests.map((manifest) => manifest.agent));
          kinds.add("omp");
          kinds.add("claude");
          // not herdr kinds: offered where this server can run them (see shell-agent.ts)
          for (const kind of Object.keys(SHELL_AGENTS)) if (shellAgentExecutable(kind)) kinds.add(kind);
          const agents: AgentKind[] = [...kinds]
            // an agent's command is its kind; the pane's shell may carry another PATH, as for omo and gjc above
            .map((kind) => ({ kind, label: AGENT_LABELS[kind] ?? kind, installed: Bun.which(kind, { PATH: process.env["PATH"] ?? "" }) !== null }))
            .sort((left, right) => left.label.localeCompare(right.label) || left.kind.localeCompare(right.kind));
          return jsonResponse({ agents });
        } catch (error) {
          return errorResponse(error);
        }
      }

      // read only: installing one changes an agent's own hooks, which stays the user's call in a terminal
      if (pathname === "/api/integrations") {
        if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
        try {
          return jsonResponse({ integrations: await integrationList() } satisfies IntegrationsResponse);
        } catch (error) {
          return errorResponse(error);
        }
      }

      if (pathname === "/api/fs/stat" || pathname === "/api/fs/file" || pathname === "/api/fs/favicon") {
        if (request.method !== "GET" && request.method !== "HEAD") return badRequest("method_not_allowed", "use GET");
        if (crossSiteFileRead(request)) return jsonResponse({ error: { code: "cross_site", message: "A file is read from this app or opened in a tab, not loaded by another page" } }, 403);
        // a folder's project icon: every place it may be kept, in one answer that a miss is part of
        if (pathname === "/api/fs/favicon") {
          const root = url.searchParams.get("root") ?? "";
          if (root.trim() === "") return badRequest("missing_root", "root is required");
          return jsonResponse({ icon: await findProjectFavicon(root) } satisfies ProjectFavicon);
        }
        const paneId = url.searchParams.get("pane_id");
        let cwd: string | null = null;
        if (paneId) {
          try { cwd = (await paneContext(paneId)).cwd; } catch { /* an absolute path still opens */ }
        }
        const path = url.searchParams.get("path") ?? "";
        const found = await findFile(path, cwd, () => paneId ? claudeTempFolder(paneId) : Promise.resolve(null));
        if (found === null) return jsonResponse({ error: { code: "not_found", message: "no readable file at that path" } }, 404);
        // several files end in that name: the viewer lists them to choose from
        if ("candidates" in found) return jsonResponse({ error: { code: "ambiguous_path", message: "several files have that name", candidates: found.candidates } }, 409);
        // a page another PC's server asks for through its bridge is played from that server's address, which this one cannot name: it is drawn as before
        const mediaSource = bridgeAuthorized ? null : pageMediaSource(requestHost, isSecureRequest(request), forwarded ? request.headers.get("x-forwarded-host") : null);
        // its media plays only for the client address that rendered it, and ends with that device (file-view.ts)
        const media = mediaSource === null ? null : { source: mediaSource, client, device: access.level === "full" ? access.device?.id ?? null : null };
        return pathname === "/api/fs/stat" ? jsonResponse(found.info) : fileResponse(found.info, url.searchParams.get("download") === "1", url.searchParams.get("render") === "1", media);
      }

      // a rendered page's own video, by the address its render gave it: the page has no origin and
      // no cookie, so the address is all it holds (requiresAuth lets this path through)
      if (pathname.startsWith(PAGE_MEDIA_PATH)) {
        if (request.method !== "GET" && request.method !== "HEAD") return badRequest("method_not_allowed", "use GET");
        const media = pageMediaResponse(pathname.slice(PAGE_MEDIA_PATH.length), client);
        return media ?? jsonResponse({ error: { code: "not_found", message: "no such page media" } }, 404);
      }

      const workspaceResponse = await handleWorkspaceRequest(request, url, pathname, bunServer, broadcastAll);
      if (workspaceResponse) return workspaceResponse;

      if (pathname === "/api/plugins/actions") {
        if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
        try {
          const [plugins, actions] = await Promise.all([pluginList(), pluginActionList()]);
          const body: PluginActionsResponse = {
            plugins: plugins.map((plugin) => ({
              plugin_id: plugin.plugin_id,
              name: plugin.name,
              version: plugin.version,
              description: plugin.description ?? null,
              enabled: plugin.enabled,
              // herdr lists another platform's actions too and refuses them: platform_unsupported
              actions: actions
                .filter((action) => action.plugin_id === plugin.plugin_id && (!action.platforms || action.platforms.includes(PLUGIN_PLATFORM)))
                .map((action) => ({ action_id: action.action_id, title: action.title, description: action.description ?? null, contexts: action.contexts ?? [] })),
            })),
          };
          return jsonResponse(body);
        } catch (error) {
          return errorResponse(error);
        }
      }

      if (pathname === "/api/plugin/action" && request.method === "GET") {
        const pluginId = url.searchParams.get("plugin_id");
        const logId = url.searchParams.get("log_id");
        if (!pluginId) return badRequest("missing_plugin_id", "plugin_id is required");
        if (!logId) return badRequest("missing_log_id", "log_id is required");
        try {
          const log = await pluginLogEntry(logId, (limit) => pluginLogList(pluginId, limit));
          return jsonResponse(await pluginActionResult(log, () => livePaneIds()));
        } catch (error) {
          return errorResponse(error);
        }
      }

      if (pathname === "/api/plugin/action") {
        if (request.method !== "POST") return badRequest("method_not_allowed", "use GET or POST");
        const payload = await readJsonObject<{ plugin_id?: unknown; action_id?: unknown; pane_id?: unknown }>(request);
        if (payload instanceof Response) return payload;
        if (typeof payload.plugin_id !== "string" || payload.plugin_id.length === 0) return badRequest("missing_plugin_id", "plugin_id is required");
        if (typeof payload.action_id !== "string" || payload.action_id.length === 0) return badRequest("missing_action_id", "action_id is required");
        if (payload.pane_id !== undefined && (typeof payload.pane_id !== "string" || payload.pane_id.length === 0)) return badRequest("invalid_pane_id", "pane_id must be a pane's ID");
        try {
          let context: PluginInvocationContext | undefined;
          if (payload.pane_id !== undefined) {
            const snapshot = await sessionSnapshot();
            const pane = snapshot.panes.find((entry) => entry.pane_id === payload.pane_id);
            // herdr would run the action with whatever ID it was handed
            if (!pane) throw new HerdrError("pane_not_found", `pane ${payload.pane_id} not found`);
            context = pluginPaneContext(snapshot, pane);
          }
          const pluginId = payload.plugin_id;
          const invoked = await pluginActionInvoke(pluginId, payload.action_id, context);
          return jsonResponse(await waitForPluginAction(
            invoked.log,
            options.pluginActionWaitMs ?? PLUGIN_ACTION_WAIT_MS,
            (timeoutMs) => pluginLogList(pluginId, PLUGIN_LOG_LIMIT, undefined, timeoutMs),
            livePaneIds,
          ));
        } catch (error) {
          return errorResponse(error);
        }
      }

      const paneResponse = await handlePaneRequest(request, url, pathname, options);
      if (paneResponse) return paneResponse;

      if (pathname === "/api/pane/pi-subagent") return piSubagentResponse(request, options.stateDir ?? defaultStateDir());

      if (pathname === "/api/pane/omo-tasks") {
        if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
        const paneId = url.searchParams.get("pane_id");
        if (!paneId) return badRequest("missing_pane_id", "pane_id query parameter is required");
        try {
          const parent = await piParentForPane(paneId);
          if (parent) {
            const activity = readPiActivity(parent, options.stateDir ?? defaultStateDir());
            const fresh = await piParentForPane(paneId);
            if (!fresh || fresh.path !== parent.path || fresh.id !== parent.id) return jsonResponse({ tasks: [], runs: [], server_time: new Date().toISOString() });
            return jsonResponse({ tasks: activity.tasks, runs: [], server_time: new Date().toISOString() }, 200, { "cache-control": "no-store" });
          }
        } catch { return jsonResponse({ error: { code: "pi_activity_unavailable", message: "Couldn't read Pi subagent activity" } }, 503); }
        const session = omo.sessionOf(paneId);
        // server_time: the browser's clock can differ from this PC's, and the list says how long tasks ran
        const server_time = new Date().toISOString();
        if (session === null) {
          // a Claude pane's subagents, read from its session's files; nothing for any other pane.
          // Its transcript is found here if the background lookup has not got to it yet
          // (for a second at most: a slow herdr answers with what is known, and the next ask has the rest)
          // An unknown pane costs a fresh herdr lookup too; the client bounds its discovery retries.
          if (claudeAgents.sessionOf(paneId) === null) {
            await within(1000, (async () => {
              await claudeAgents.ensure(await paneGet(paneId));
            })());
          }
          const claude = claudeAgents.sessionOf(paneId);
          return jsonResponse({ tasks: claude === null ? [] : claudeSubagents(claude.path, claude.live, Date.now(), claude.startedAt), runs: [], server_time });
        }
        return jsonResponse({ tasks: omoTasks(session.cwd, session.sessionId, processAlive), runs: omoRuns(session.cwd, session.sessionId), server_time });
      }

      if (pathname === "/api/pane/plan") {
        if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
        const paneId = url.searchParams.get("pane_id");
        if (!paneId) return badRequest("missing_pane_id", "pane_id query parameter is required");
        // the pane as herdr has it now, for a second at most: one the background lookup has not got to yet is looked
        // up here, and so is one that runs another session than the one its transcript was found for.
        // Herdr may name an OmO pane `claude`: use its resolved identity before looking up a plan.
        const seen: { pane?: HerdrPane } = {};
        await within(1000, (async () => {
          const pane = seen.pane = omo.apply(await sessionSnapshot()).panes.find((candidate) => candidate.pane_id === paneId);
          if (pane === undefined || plans.known(pane)) return;
          if (pane.agent === "claude") await claudeAgents.ensure(pane);
          await plans.ensure(pane, true);
        })());
        // only the pane as herdr has it now is told its plan: one herdr did not answer for in time, no longer has, or has
        // in a session not looked up yet is told none, never the plan read before (session-plan.ts planOf)
        const steps = plans.planOf(seen.pane);
        const answer: PanePlan = { plan: steps === null ? null : { steps }, server_time: new Date().toISOString() };
        return jsonResponse(answer);
      }

      if (pathname.startsWith("/api/pane/prompt")) {
        try {
          const response = await handlePromptRequest(request, url, { serialize, codexHome: options.codexHome, claudeTranscript: (paneId) => claudeAgents.sessionOf(paneId)?.path ?? null, readOnly });
          if (response) return response;
        } catch (error) {
          return errorResponse(error);
        }
      }

      if (pathname.startsWith("/api/")) {
        return jsonResponse({ error: { code: "not_found", message: `unknown endpoint ${pathname}` } }, 404);
      }

      // static client - public even when the API is gated, so the login UI can load
      return serveStatic(pathname, request.headers.get("accept-encoding"), requestOrigin(request));
      })());
    },

    websocket: {
      // This transport cap also covers clients that predate application ACKs.
      backpressureLimit: OUTPUT_HARD_BYTES,
      closeOnBackpressureLimit: true,
      drain(client) {
        drainOutput(client);
      },
      async open(client) {
        if (!admit(client)) return;
        if (client.data.relay) { client.data.relay.bind(client as ServerWebSocket<unknown>); return; }
        clients.add(client);
        const snapshot = clientSnapshot();
        countVisit(snapshot);
        try {
          send(client, { type: "snapshot", snapshot: await snapshot, features: SERVER_FEATURES });
        } catch (error) {
          const code = error instanceof HerdrError ? error.code : "snapshot_failed";
          send(client, { type: "error", code, message: error instanceof Error ? error.message : String(error) });
        }
      },

      async message(client, raw) {
        if (stopped || connectionOf(client).closing) return;
        // read here for a relayed connection too: alerts for every PC go out from this server
        const presence = presenceOf(raw);
        if (presence === true) {
          present.add(client);
          if (!client.data.relay) countVisit();
        } else if (presence === false) present.delete(client);
        if (client.data.relay) { client.data.relay.message(raw); return; }
        if (presence !== null) return;
        let message: ClientMessage;
        try {
          message = JSON.parse(String(raw)) as ClientMessage;
        } catch {
          send(client, { type: "error", code: "invalid_json", message: "message must be JSON" });
          return;
        }
        try {
          switch (message.type) {
            // liveness only: any role, no herdr call, nothing to wait behind
            case "ping": {
              if (!Number.isSafeInteger(message.id)) {
                send(client, { type: "error", code: "invalid_ping", message: "id must be an integer" });
                break;
              }
              send(client, { type: "pong", id: message.id });
              break;
            }
            case "watch": {
              const geometry = validGeometry(message.cols, message.rows);
              if (!geometry) {
                send(client, { type: "error", code: "invalid_geometry", message: "cols and rows must be integers in 1..1000" });
                break;
              }
              watchPane(client, message.pane_id, geometry);
              break;
            }
            case "unwatch": {
              unwatchPane(client, message.pane_id);
              break;
            }
            case "attach":
              await terminalFrames.attach(client, message);
              break;
            case "take-over":
              terminalFrames["take-over"](client, message);
              break;
            case "detach":
              terminalFrames.detach(client, message);
              break;
            case "conversation-watch":
              terminalFrames["conversation-watch"](client, message);
              break;
            case "pty-ack":
              terminalFrames["pty-ack"](client, message);
              break;
            case "input": {
              if (connectionOf(client).mode === "observe") {
                send(client, { type: "error", code: "read_only", message: "this connection is in observe mode" });
                break;
              }
              // typing goes straight through the pty, unless a composer message is still in
              // flight: then it waits its turn and goes the message's own way (send_text), since
              // the pty holds a lone ESC ~150ms and a Stop would overtake nothing
              // typing reaches an attached pane only, queued or not
              const sighting = sight(client, message.pane_id);
              const seen = sighting.facts();
              const inputFailed = () => {
                if (clients.has(client)) send(client, { type: "error", code: "input_failed", message: "Terminal input could not be confirmed. Check the terminal before typing again.", pane_id: message.pane_id });
              };
              // without a pty (Windows: no terminal, or a mirrored one) typing, the key bar's Enter,
              // Stop and arrows go through herdr itself, each in its turn behind a message in flight.
              // The turn is taken before herdr is asked what it can do: a message sent while
              // that answer is on its way must not overtake the typing.
              if (terminalAttachKnown === false || (!seen.attached && terminalAttachKnown === null)) {
                // an attach this client is not a member of owns this pane's screen, and typing
                // here would reach past it — the same refusal the pty branch below makes. A
                // pane with no attachment at all is left as it was: that is the key bar, and
                // an older bridge's composer send, neither of which attaches first.
                if (seen.attached && !seen.member) {
                  send(client, { type: "error", code: "input_not_ready", message: "Terminal input is not ready. Nothing was sent.", pane_id: message.pane_id });
                  break;
                }
                const text = message.text;
                // typed into the attach it saw, or into none: one left meanwhile (even attached again) takes none of it
                const roles = connectionOf(client).roles;
                // checked again right before herdr is written to: its connect is awaited (#545)
                // and into the same attach, or still none: one made while this waited is someone else's (#732)
                const allowed = () => mayType(client) && connectionOf(client).roles === roles && typingGuards.herdrTyping(sighting.facts());
                if (allowed()) lettaStops.invalidate(message.pane_id);
                void serialize(message.pane_id, async () => {
                  // a herdr that attaches: typing reaches an attached pane only
                  if (await terminalAttach()) { inputFailed(); return; }
                  // a pasted block asks herdr what the pane runs, so it is shaped before the checks below
                  const shaped = await mirrorInput(text, async () => (await paneContext(message.pane_id)).agent);
                  if (!typingGuards.herdrTyping(sighting.facts())) { inputFailed(); return; }
                  // nothing typed outlives its connection
                  if (!clients.has(client)) return;
                  authorizeSocket(client);
                  await paneSendText(message.pane_id, shaped, undefined, allowed);
                  // the echo is read at once, not at the mirror's next idle read
                  poke(message.pane_id);
                }).catch(inputFailed);
                break;
              }
              // another web bridge has this pane's terminal: nothing typed here reaches it
              if (!seen.member || !seen.ready || seen.held) {
                send(client, { type: "error", code: "input_not_ready", message: "Terminal input is not ready. Nothing was sent.", pane_id: message.pane_id });
                break;
              }
              if (mayType(client) && typingGuards.queuedTyping(seen)) lettaStops.invalidate(message.pane_id);
              const typedIntoPty = (text: string) => {
                lastTyped.set(message.pane_id, Date.now());
                if (text.endsWith("\x1b")) typedEscape.add(message.pane_id); else typedEscape.delete(message.pane_id);
                if (lastTyped.size > 64) {
                  for (const [pane, at] of lastTyped) if (Date.now() - at > TYPED_SETTLE_MS) { lastTyped.delete(pane); typedEscape.delete(pane); }
                }
              };
              // the composer's Stop: a message sent right after it must not reach the agent first, and a
              // pty write only queues the ESC in the sidecar, so it goes the message's own way (send_text)
              // in the pane's turn. Plain typing, a terminal ESC included, keeps the pty's FIFO order.
              const stop = message.stop === true && message.text === "\u001b";
              if (paneQueues.has(message.pane_id) || stop) {
                const text = message.text;
                // a click or a wheel (a click replayed behind a held arrow) is the attach's own mouse:
                // herdr encodes it for the program's mouse mode, send_text would type its bytes (#667)
                const mouse = isMouseReport(text);
                // typed into the attach it saw: one that ended meanwhile (and was attached again) takes none of it
                const roles = connectionOf(client).roles;
                const allowed = () => mayType(client) && connectionOf(client).roles === roles && typingGuards.queuedTyping(sighting.facts());
                void serialize(message.pane_id, async () => {
                  // behind typing still in the sidecar, as a terminal key waits for it
                  if (stop) await settleAfterTyping(message.pane_id);
                  // held while this waited its turn: it goes nowhere, as unqueued typing would
                  if (!typingGuards.queuedTyping(sighting.facts())) { inputFailed(); return; }
                  // nothing typed outlives its connection
                  if (!clients.has(client)) return;
                  authorizeSocket(client);
                  if (mouse) {
                    if (!allowed() || !sighting.write(text)) { inputFailed(); return; }
                    typedIntoPty(text);
                    return;
                  }
                  let ticket: LettaStopTicket<Client, PendingLease> | null = null;
                  let stopLetta = false;
                  if (stop) {
                    try {
                      const lease = pendingLease(client, message.pane_id);
                      const epoch = lettaStops.epoch(message.pane_id);
                      const generation = pending.mark(message.pane_id);
                      stopLetta = (await clientSnapshot()).panes.find((pane) => pane.pane_id === message.pane_id)?.agent === "letta";
                      const context = await pendingContext(client, message.pane_id, lease);
                      if (lease.sighting.facts().sameClaim && pending.mark(message.pane_id) === generation) {
                        ticket = lettaStops.begin(client, message.pane_id, lease, { ...context, generation }, epoch);
                      }
                    } catch { /* Normal Stop remains available; no compatibility witness. */ }
                  }
                  try { await paneSendText(message.pane_id, text, undefined, allowed); }
                  catch (error) { lettaStops.invalidate(message.pane_id); throw error; }
                  if (stopLetta) pending.interruptReview(message.pane_id);
                  if (ticket && lettaStops.current(ticket)) void observeLettaStop(ticket);
                  // herdr still holds a lone ESC a moment: a message after the Stop waits out the same
                  // settling gap as after a typed one, and checks again for a question before pasting
                  if (stop) typedIntoPty(text);
                }).catch(inputFailed);
              } else {
                if (!sighting.write(message.text)) { inputFailed(); break; }
                typedIntoPty(message.text);
              }
              break;
            }
            case "resize":
              await terminalFrames.resize(client, message);
              break;
            case "release-size":
              terminalFrames["release-size"](client, message);
              break;
            case "keys": {
              if (connectionOf(client).mode === "observe") {
                send(client, { type: "error", code: "read_only", message: "this connection is in observe mode" });
                break;
              }
              // Terminal chords belong to the attachment that accepted them, just like input.
              // Unattached RPC keys retain their existing path (including native Windows).
              const sighting = sight(client, message.pane_id);
              const seen = sighting.facts();
              const roles = connectionOf(client).roles;
              if (seen.currentHeld) {
                send(client, { type: "error", code: "attach_held", message: ATTACH_HELD_MESSAGE, pane_id: message.pane_id });
                break;
              }
              // an attach still being looked up: its chord has no attachment to belong to yet, and must
              // not take the unattached RPC path around the claim it will be checked against
              if (!seen.origin && seen.claimed) {
                send(client, { type: "error", code: "input_not_ready", message: "Terminal input is not ready. Nothing was sent.", pane_id: message.pane_id });
                break;
              }
              if (mayType(client) && typingGuards.keys(seen)) lettaStops.invalidate(message.pane_id);
              // A key behind keys of the same sender that have not gone out yet joins them, as long as
              // nothing else was queued since: one RPC carries them all, so keys held faster than herdr
              // answers (a slow herdr, a busy PC) never queue up an RPC each, and keep their order.
              const waiting = waitingKeys.get(message.pane_id);
              if (waiting && !waiting.sent && waiting.client === client && waiting.origin === sighting.origin && waiting.pty === sighting.pty && waiting.claim === sighting.claim
                // a key pressed after the sender watched and came back is checked on its own: joined, the
                // batch's older role would refuse it with the rest
                && waiting.roles === roles
                && waiting.run !== null && paneQueues.get(message.pane_id) === waiting.run) {
                // a herdr that stopped answering does not collect keys without end: past this, they are refused
                if (waiting.keys.length + message.keys.length > MAX_WAITING_KEYS) {
                  send(client, { type: "error", code: "input_failed", message: "Terminal input could not be confirmed. Check the terminal before typing again.", pane_id: message.pane_id });
                  break;
                }
                waiting.keys.push(...message.keys);
                break;
              }
              const batch = { keys: [...message.keys], client: client as unknown, origin: sighting.origin, pty: sighting.pty, claim: sighting.claim, roles, run: null as Promise<unknown> | null, sent: false };
              const run = serialize(message.pane_id, async () => { try {
                // A key goes through herdr's RPC, around the attach pty that typing just went into: it
                // waits for that typing as a composer message does, or it overtakes it (a lone ESC is
                // held there ~150ms). The checks below run after the wait.
                if (seen.origin && !seen.mirror) await settleAfterTyping(message.pane_id);
                // the attach this chord was pressed in is gone (left, replaced, or left and joined again).
                // `input_failed`, as queued typing answers: `input_not_ready` makes the client drop the
                // pane's readiness, and the attach it holds by now has already been told it is ready
                const facts = sighting.facts();
                if (facts.origin && (!facts.sameAttachment || !facts.samePty || !facts.sameClaim || !facts.member)) {
                  if (clients.has(client)) send(client, { type: "error", code: "input_failed", message: "Terminal input could not be confirmed. Check the terminal before typing again.", pane_id: message.pane_id });
                  return;
                }
                if (facts.origin && !facts.ready) {
                  if (clients.has(client)) send(client, { type: "error", code: "input_not_ready", message: "Terminal input is not ready. Nothing was sent.", pane_id: message.pane_id });
                  return;
                }
                // held while this waited its turn (the attach was refused after the check above)
                if (facts.currentHeld) {
                  send(client, { type: "error", code: "attach_held", message: ATTACH_HELD_MESSAGE, pane_id: message.pane_id });
                  return;
                }
                // a key pressed by a connection that has gone since is not pressed
                if (!clients.has(client)) return;
                authorizeSocket(client);
                // the same checks once more right before herdr is written to: its connect is awaited (#545)
                const allowed = () => mayType(client) && connectionOf(client).roles === roles && typingGuards.keys(sighting.facts());
                batch.sent = true;
                try {
                  await paneSendKeys(message.pane_id, batch.keys, undefined, allowed);
                } catch (error) {
                  if (!(error instanceof HerdrError && error.code === "cancelled")) throw error;
                  if (clients.has(client)) send(client, { type: "error", code: "input_failed", message: "Terminal input could not be confirmed. Check the terminal before typing again.", pane_id: message.pane_id });
                  return;
                }
                poke(message.pane_id);
              } finally {
                batch.sent = true;
                if (waitingKeys.get(message.pane_id) === batch) waitingKeys.delete(message.pane_id);
              } });
              batch.run = run;
              waitingKeys.set(message.pane_id, batch);
              await run;
              break;
            }
            case "secret": {
              // Refuse busy panes instead of retaining the secret behind another send.
              const result = (ok: boolean, code?: string) => send(client, {
                type: "secret-result", id: message.id, pane_id: message.pane_id, ok, ...(code ? { code } : {}),
              });
              try {
                if (!Number.isSafeInteger(message.id) || typeof message.pane_id !== "string"
                  || typeof message.prompt !== "string" || secretPrompt(message.prompt) !== message.prompt || !validSecret(message.secret)) {
                  result(false, "invalid_secret"); break;
                }
                if (connectionOf(client).mode === "observe") { result(false, "read_only"); break; }
                // the attach this secret was sent from: leaving it (even joining again) takes the secret back,
                // and so do a new pty or role: a live handoff or a switch away and back during the screen read (#589)
                const sighting = sight(client, message.pane_id);
                const seen = sighting.facts();
                if (!seen.member) { result(false, "not_attached"); break; }
                // Mirrored cleanup uses Backspace on Windows too: only printable ASCII erases reliably.
                if (seen.mirror && /[^\x20-\x7e]/.test(message.secret)) { result(false, "invalid_secret"); break; }
                if (!seen.ready || seen.held) { result(false, "input_not_ready"); break; }
                if (paneQueues.has(message.pane_id)) { result(false, "pane_busy"); break; }
                const roles = connectionOf(client).roles;
                await serialize(message.pane_id, async () => {
                  // A viewport scrolled into history can still show an old password prompt.
                  // Validate the live screen before typing a secret into the current program.
                  const screen = await paneRead({ paneId: message.pane_id, source: "detection", format: "text" });
                  if (connectionOf(client).closing || connectionOf(client).mode === "observe" || connectionOf(client).roles !== roles) { result(false, "read_only"); return; }
                  authorizeSocket(client);
                  const facts = sighting.facts();
                  if (!facts.member || !facts.sameAttachment || !facts.sameClaim) { result(false, "not_attached"); return; }
                  if (!facts.ready || facts.held || !facts.samePty) { result(false, "input_not_ready"); return; }
                  if (secretPrompt(screen.text, facts.cols) !== message.prompt) { result(false, "prompt_changed"); return; }
                  lettaStops.invalidate(message.pane_id);
                  if (facts.mirror) {
                    // A mirrored pane has no pty to type into: the secret is herdr's text, then the
                    // Enter key (a `\r` inside the text is not Enter to every shell). Both are awaited,
                    // so a send herdr refused is answered as failed, not as entered.
                    const allowed = () => mayType(client) && connectionOf(client).roles === roles && typingGuards.mirrorSecret(sighting.facts());
                    try {
                      await paneSendText(message.pane_id, message.secret, undefined, allowed);
                    } catch (error) {
                      if (error instanceof HerdrError && error.code === "cancelled") { result(false, "not_attached"); return; }
                      throw error;
                    }
                    try {
                      // Typing finished; recheck authority after the Enter RPC connects (#900).
                      await paneSendKeys(message.pane_id, ["Enter"], undefined, allowed);
                    } catch (error) {
                      if (!(error instanceof HerdrError && error.code === "cancelled")) throw error;
                      // Cleanup is deliberately unguarded: do not leave the secret for another Enter.
                      // Raw-mode readers may receive these bytes without erasing their own buffer.
                      await paneSendKeys(message.pane_id, Array(message.secret.length).fill("Backspace"));
                      result(false, connectionOf(client).closing || connectionOf(client).roles !== roles
                        ? "read_only" : "not_attached");
                      return;
                    }
                  } else {
                    // Direct attach keystrokes: no agent transcript, RPC payload or delayed Enter.
                    if (!sighting.write(`${message.secret}\r`)) { result(false, "input_not_ready"); return; }
                  }
                  result(true);
                });
              } catch {
                // Never forward an exception that might include submitted bytes.
                result(false, "secret_failed");
              } finally { message.secret = ""; }
              break;
            }
            case "submit": {
              // every submit is answered: the composer keeps its text until it hears back
              const result = (ok: boolean, code?: string, text?: string, accepted?: PendingMessage, draft?: string | null, box?: string | null) => send(client, {
                type: "submit-result", id: message.id, pane_id: message.pane_id, ok, ...(accepted ? { pending: accepted } : {}), ...(code ? { code, message: text } : {}),
                ...(draft ? { draft } : {}), ...(!draft && typeof box === "string" ? { box } : {}),
              });
              if (!Number.isSafeInteger(message.id) || typeof message.pane_id !== "string" || !message.pane_id
                || typeof message.text !== "string" || typeof message.payload !== "string") {
                send(client, { type: "error", code: "invalid_submit", message: "id must be an integer, pane_id, text and payload strings" });
                break;
              }
              const waits = message.delivery === "queue" || message.delivery === "hold";
              if ((message.delivery !== undefined && message.delivery !== "immediate" && !waits)
                || (waits && message.typed !== undefined && message.typed !== false)) {
                result(false, "invalid_delivery", "Use immediate delivery, or queue or hold a chat message");
                break;
              }
              if (message.clear_draft !== undefined && (typeof message.clear_draft !== "string" || !message.clear_draft
                || waits || (message.typed !== undefined && message.typed !== false))) {
                result(false, "invalid_delivery", "Clear a terminal draft only for a chat message sent at once");
                break;
              }
              if (message.send_anyway !== undefined && (message.send_anyway !== true || waits || message.clear_draft !== undefined
                || (message.typed !== undefined && message.typed !== false))) {
                result(false, "invalid_delivery", "Send anyway only a chat message sent at once, without clearing a draft");
                break;
              }
              if (message.resend_id !== undefined && (typeof message.resend_id !== "string" || !message.resend_id || message.resend_id.length > 128
                || waits || message.typed === true || message.clear_draft !== undefined || message.send_anyway !== undefined)) {
                result(false, "invalid_delivery", "Use a held-copy resend id only for an immediate chat message");
                break;
              }
              if (message.resend_generation !== undefined && (!Number.isSafeInteger(message.resend_generation) || message.resend_generation < 0 || message.resend_id === undefined)) {
                result(false, "invalid_delivery", "A resend generation must be a nonnegative integer with a held-copy id");
                break;
              }
              if (connectionOf(client).mode === "observe") {
                result(false, "read_only", "this connection is in observe mode");
                break;
              }
              // another web bridge has this pane's terminal: its user types there, not this one
              if (attachments.get(message.pane_id)?.held) {
                result(false, "attach_held", ATTACH_HELD_MESSAGE);
                break;
              }
              const arrivedAt = Date.now();
              try {
                if (!waits && !message.typed && message.resend_id === undefined && message.clear_draft === undefined && !message.send_anyway) {
                  let book = pendingRequests.get(client);
                  const fingerprint = new Bun.CryptoHasher("sha256").update(JSON.stringify([message.pane_id, message.text, message.payload, message.delivery])).digest("hex");
                  const previous = book?.get(message.id, fingerprint);
                  if (previous || lettaStops.available(client, message.pane_id)) {
                    if (!book) { book = new PendingRequestBook((reply: SubmitReply) => reply.pending !== undefined && pending.retains(client, reply.pending.id)); pendingRequests.set(client, book); }
                    const answer = await (previous ?? book.run(message.id, fingerprint, () => serialize(message.pane_id, async () =>
                      await dispatchLettaRecovery(client, message.pane_id, message.text, arrivedAt)
                      ?? { ok: false, code: "pending_target_changed", message: "The stopped terminal changed; check it before sending again" })));
                    result(answer.ok, answer.code, answer.message);
                    break;
                  }
                }
                if (waits) {
                  let book = pendingRequests.get(client);
                  if (!book) { book = new PendingRequestBook((reply: SubmitReply) => reply.pending !== undefined && pending.retains(client, reply.pending.id)); pendingRequests.set(client, book); }
                  // a digest, so a receipt kept for replay never holds a large request's bytes
                  const fingerprint = new Bun.CryptoHasher("sha256").update(JSON.stringify([message.pane_id, message.text, message.payload, message.delivery])).digest("hex");
                  const previous = book.get(message.id, fingerprint);
                  const lease = previous ? null : pendingLease(client, message.pane_id);
                  const reply = previous ?? book.run(message.id, fingerprint, () => serialize(message.pane_id, async (): Promise<SubmitReply> => {
                    const text = pendingText(message.text);
                    if (message.delivery === "queue") {
                      const recovery = await dispatchLettaRecovery(client, message.pane_id, text, arrivedAt);
                      if (recovery) return recovery;
                    }
                    lettaStops.ownerLeft(client, message.pane_id);
                    const mark = pending.mark(message.pane_id);
                    const context = await pendingContext(client, message.pane_id, lease!);
                    if (Date.now() - arrivedAt > (options.submitDeadlineMs ?? SUBMIT_DEADLINE_MS)) throw new HerdrError("submit_timeout", "This pending message waited too long; nothing was typed");
                    if (!context.working) {
                      // the agent left while the message was on its way: a chat follow-up is not typed into what is there now
                      if (context.identity.agent === null) throw new HerdrError("agent_not_ready", "No agent is in front of this pane now; nothing was typed");
                      // A request that raced the turn's finish still needs cancellable
                      // paste + Enter; agent.prompt commits its key inside herdr. With a message
                      // already waiting its turn here, this one takes its place behind it instead.
                      // A held message is never typed by arriving after the turn: it waits for Send now.
                      if (message.delivery === "queue" && !pending.waiting(message.pane_id)) return dispatchPendingText(client, message.pane_id, text, lease!, context.identity, false, arrivedAt);
                    }
                    pending.observe(message.pane_id, context.pane.agent_status, mark);
                    // hold: kept for the owner's Send now, never sent by the turn's end
                    const item = pending.enqueue(client, message.pane_id, message.id, text, lease!, context.identity, message.delivery === "hold");
                    return { ok: true, pending: item.message };
                  }).catch((error): SubmitReply => ({ ok: false, ...pendingFault(error) })));
                  const answer = await reply;
                  const accepted = answer.pending ? pending.get(client, message.pane_id, answer.pending.id)?.message : undefined;
                  if (answer.pending && !accepted) replayPendingOutcome(client, message.pane_id, answer.pending.id);
                  result(answer.ok, answer.code, answer.message, accepted);
                  drainPending(message.pane_id);
                  break;
                }
                const dispatch = () => {
                  lettaStops.ownerLeft(client, message.pane_id);
                  // held while this waited its turn (the attach was refused after the check above)
                  if (attachments.get(message.pane_id)?.held) throw new HerdrError("attach_held", ATTACH_HELD_MESSAGE);
                  return submitText(message.pane_id, message.text, message.payload, arrivedAt, message.typed === true, () => authorizeSocket(client), message.clear_draft,
                    draftConfirmations.get(client)?.get(message.pane_id), message.send_anyway === true);
                };
                if (message.resend_id !== undefined) {
                  authorizeSocket(client);
                  const answer = await serialize(message.pane_id, () => pending.resend(message.pane_id, message.resend_id!,
                    new Bun.CryptoHasher("sha256").update(message.text).digest("hex"), async () => {
                      try { await dispatch(); return { ok: true }; }
                      catch (error) { return { ok: false, ...pendingFault(error) }; }
                    }, message.resend_generation));
                  result(answer.ok, answer.code, answer.message);
                  break;
                }
                await serialize(message.pane_id, dispatch);
                if (message.clear_draft !== undefined || message.send_anyway) draftConfirmations.get(client)?.delete(message.pane_id);
                result(true);
              } catch (error) {
                if (message.clear_draft !== undefined || message.send_anyway) draftConfirmations.get(client)?.delete(message.pane_id);
                // a refusal naming a draft confirms it for Clear it and send; one naming none, for Send anyway
                if (error instanceof InputDraftError && error.identity && (error.draft || error.box !== null)) {
                  let confirmations = draftConfirmations.get(client);
                  if (!confirmations) { confirmations = new Map(); draftConfirmations.set(client, confirmations); }
                  confirmations.set(message.pane_id, { draft: error.draft, identity: error.identity, box: error.box });
                }
                const fault = pendingFault(error);
                result(false, fault.code, fault.message, undefined, error instanceof InputDraftError ? error.draft : null,
                  error instanceof InputDraftError && error.identity && error.box !== null ? shownInputBox(error.box) : null);
              }
              break;
            }
            case "pending-action": {
              lettaStops.ownerLeft(client, message.pane_id);
              const result = (reply: SubmitReply) => send(client, { type: "pending-result", id: message.id, pane_id: message.pane_id, pending_id: message.pending_id, ...reply });
              if (!Number.isSafeInteger(message.id) || typeof message.pane_id !== "string" || !message.pane_id
                || typeof message.pending_id !== "string" || !message.pending_id || !["steer", "discard", "withdraw"].includes(message.action)) {
                result({ ok: false, code: "invalid_pending_action", message: "Use steer, discard or withdraw with a pending-message id" }); break;
              }
              if (message.resend_generation !== undefined && (!Number.isSafeInteger(message.resend_generation) || message.resend_generation < 0)) {
                result({ ok: false, code: "invalid_pending_action", message: "A resend generation must be a nonnegative integer" }); break;
              }
              const arrivedAt = Date.now();
              try {
                authorizeSocket(client);
                const lease = message.action === "steer" ? pendingLease(client, message.pane_id) : null;
                const answer = await serialize(message.pane_id, async (): Promise<SubmitReply> => {
                  authorizeSocket(client);
                  if (!clients.has(client) || connectionOf(client).closing) throw new HerdrError("disconnected", "This connection closed");
                  const item = pending.get(client, message.pane_id, message.pending_id);
                  if (!item) return replayPendingOutcome(client, message.pane_id, message.pending_id)
                    ? { ok: true } : { ok: false, code: "pending_not_found", message: "This pending message does not belong to this connection" };
                  if (message.action === "withdraw") return pending.withdraw(item) ? { ok: true }
                    : { ok: false, code: "pending_not_withdrawable", message: "This message may already have been sent; copy it or check the terminal before editing" };
                  if (message.action === "discard") return pending.discard(item) ? { ok: true } : { ok: false, code: "pending_busy", message: "This message is already being sent" };
                  if (item.message.state === "uncertain") return { ok: false, code: "pending_uncertain", message: "Check the terminal before sending this message again" };
                  let dispatched = false;
                  const reply = await pending.resend(item.paneId, item.message.id,
                    new Bun.CryptoHasher("sha256").update(item.message.text).digest("hex"), async (): Promise<SubmitReply> => {
                      try {
                        await pendingContext(client, item.paneId, lease!, item.identity);
                        if (!pending.claim(item, false)) return { ok: false, code: "pending_busy", message: "This message is already being sent" };
                        item.lease = lease!;
                        dispatched = true;
                        return await dispatchPending(item, false, arrivedAt, true);
                      } catch (error) { return { ok: false, ...pendingFault(error) }; }
                    }, message.resend_generation);
                  // A saved copy may already have completed this ID on another connection.
                  if (!dispatched && pending.get(client, item.paneId, item.message.id) === item && pending.claim(item, false))
                    pending.settle(item, reply.ok ? undefined : { code: reply.code!, message: reply.message! }, reply.code === "submit_changed");
                  return reply;
                });
                result(answer);
                drainPending(message.pane_id);
              } catch (error) { result({ ok: false, ...pendingFault(error) }); }
              break;
            }
            case "role": {
              if (message.mode !== "interact" && message.mode !== "observe") {
                send(client, { type: "error", code: "invalid_role", message: "mode must be interact or observe" });
                break;
              }
              if (client.data.readOnly) message.mode = "observe";
              if (message.mode === "observe") holdPending(client);
              setRole(client, message.mode);
              send(client, { type: "role-ack", mode: message.mode });
              if (message.mode === "observe") {
                // the fresh observer needs the grid it must adopt
                for (const paneId of client.data.attached.keys()) {
                  const attachment = attachments.get(paneId);
                  if (attachment) {
                    send(client, { type: "pane-geometry", pane_id: paneId, cols: attachment.cols, rows: attachment.rows });
                  }
                }
              }
              break;
            }
          }
        } catch (error) {
          const code = error instanceof HerdrError ? error.code : "command_failed";
          // an attach that could not start names its pane: the panes of a PC share this connection, and one
          // without a pane would end every terminal on it
          const failed = code === "attach_failed" && message.type === "attach" ? { pane_id: message.pane_id } : {};
          send(client, { type: "error", code, message: error instanceof Error ? error.message : String(error), ...failed });
        }
      },

      close(client) {
        end(client, "closed");
      },
    },
  });

  if (options.portal) {
    let resume: Promise<void>;
    try {
      resume = options.portal.resume({ port: server.port ?? DEFAULT_PORT, tokenSet: token !== "", serveOnly });
    } catch (error) {
      resume = Promise.reject(error);
    }
    void resume.then(
      () => settlePortalStartup({ ok: true }),
      (error: unknown) => settlePortalStartup({ ok: false, error }),
    );
  } else {
    settlePortalStartup({ ok: true });
  }

  const registration = options.registerBridge ? registerBridge(server.port ?? 0, bridgeToken) : null;

  // ACKs can stop arriving entirely (a suspended tab). Bound the pause even then.
  const outputTimer = setInterval(() => {
    pending.expire();
    lettaStops.expire();
    for (const paneId of attachments.keys()) reconcileOutput(paneId);
  }, 100);
  outputTimer.unref();

  return {
    port: server.port ?? 0,
    hostname,
    statusReady: collector.ready,
    alertsSettled: () => push.settled(),
    stop: () => {
      stopped = true;
      settlePortalStartup({ ok: false, error: new Error("Server stopped before Portal startup cleanup completed") });
      conversations.stop();
      clearInterval(outputTimer);
      collector.stop();
      omo.stop();
      gjc.stop();
      claudeAgents.stop();
      piAgents.stop();
      clearInterval(waitTimer);
      plans.stop();
      machines?.stop();
      void options.portal?.shutdown();
      registration?.close();
      for (const client of clients) killWatches(client);
      for (const paneId of [...attachments.keys()]) closeAttachment(paneId);
      server.stop(true);
    },
  };
}

if (import.meta.main) {
  const updates = connectUpdater();
  const version = (JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as { version: string }).version;
  const telemetry = new Telemetry({ stateDir: defaultStateDir(), version, env: process.env, fetch, previousVersion: () => updates.installed().previous_version });
  const portal = new PortalService({ stateDir: defaultStateDir() });
  let instance: ReturnType<typeof createServer>;
  try {
    instance = createServer({ updates, herdrUpdate: new HerdrUpdater(), portal, telemetry, registerBridge: true, herdrProfiles: readHerdrProfiles });
  } catch (err) {
    const { code, syscall } = err as { code?: string; syscall?: string };
    // only the bind itself: a permission error reading a state file keeps its own message and path
    if (syscall !== "listen" || (code !== "EADDRINUSE" && code !== "EADDRNOTAVAIL" && code !== "EACCES")) throw err;
    const host = process.env["HOST"] ?? "127.0.0.1";
    const port = process.env["PORT"] || DEFAULT_PORT;
    const reason = code === "EADDRINUSE"
      ? `the port is in use. Another app (or herdr web ui) may already use it; start with another PORT=, or open http://${host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host}:${port} if it is this app`
      : code === "EADDRNOTAVAIL"
        ? "this PC has no such address; try HOST=127.0.0.1"
        : "the port needs permission; try a PORT above 1024";
    console.error(`herdr web ui cannot listen on ${host}:${port}: ${reason}.`);
    process.exit(1);
  }
  telemetry.start();
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    telemetry.stop();
    instance.stop();
    // Attach sidecars need ~1.2s to release herdr's exclusive client slot; Portal unregisters from
    // its relay, and the pipes it logs to must outlive it
    void Promise.all([Bun.sleep(2000), portal.shutdown()]).then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  if (process.env["HERDR_WEB_MANAGED"] === "1") process.on("disconnect", shutdown);
  console.log(`herdr-web-ui listening on http://${instance.hostname}:${instance.port}`);
  const socket = herdrSocketPath();
  void ping(socket).catch(() => {
    console.error(`herdr is not reachable at ${socket}: start herdr, or set HERDR_SOCKET to its socket (named sessions: ~/.config/herdr/sessions/<name>/herdr.sock).`);
  });
  // the state folder is created on first write, so test the nearest folder that exists
  const stateDir = defaultStateDir();
  let probe = stateDir;
  while (true) {
    try {
      accessSync(probe, constants.F_OK);
      break;
    } catch {
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  try {
    accessSync(probe, constants.W_OK);
  } catch {
    console.error(`cannot write ${stateDir}: settings, devices and updates will not be saved; fix its permissions or set HERDR_WEB_STATE_DIR.`);
  }
  if (!isLoopbackBind(instance.hostname)) {
    if (lanExposed({ hostname: instance.hostname, tokenConfigured: (process.env["HERDR_WEB_TOKEN"] ?? "") !== "", gated: false })) {
      console.error(
        `WARNING: listening on ${instance.hostname} without HERDR_WEB_TOKEN - until a device is paired (Settings → Devices, on this PC) anyone who can reach this address can type into your terminals; pair your devices, set HERDR_WEB_TOKEN=<token>, or keep HOST=127.0.0.1 and reach it through Tailscale or an SSH tunnel.`,
      );
    }
    // The bind address says nothing about the transport: a token cookie and every keystroke
    // travel in the clear on plain http, so a listener on the same network gets them.
    if ((process.env["HERDR_WEB_TOKEN"] ?? "") !== "") {
      console.error(
        `WARNING: listening on http://${instance.hostname}:${instance.port} - HERDR_WEB_TOKEN is not confidential over cleartext http; on an untrusted network anyone who can read the traffic has the token and everything you type. Reach this PC over Tailscale, put it behind a TLS-terminating proxy, or keep HOST=127.0.0.1.`,
      );
    }
  }
}
