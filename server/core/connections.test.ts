import { expect, it, spyOn } from "bun:test";
import * as coreRuntime from "../herdr-core/runtime.ts";
import type { HcConnection } from "../herdr-core/connection.ts";
import { OUTPUT_STALLED_CLOSE_CODE } from "../../shared/terminal-flow.ts";
import type { DeviceStore } from "../devices.ts";
import type { MachineRelay } from "../machine-relay.ts";
import type { PendingInputs } from "../pending-input.ts";
import { type Client, connectionData, connectionOf, createConnections, paneWatchSupported, send } from "./connections.ts";

function harness({ deviceId, readOnly = false, relay, revokedAlready = false }: { deviceId?: string; readOnly?: boolean; relay?: MachineRelay; revokedAlready?: boolean } = {}) {
  const log: string[] = [];
  const messages: unknown[] = [];
  const revocations: (() => void)[] = [];
  const devices = {
    onRevoke: (_id: string, close: () => void) => {
      if (revokedAlready) close(); else revocations.push(close);
      return () => log.push("unwatch device");
    },
  } as unknown as DeviceStore;
  const pending = { close: () => log.push("pending closed") } as unknown as PendingInputs<Client, never>;
  const client = {
    data: connectionData({ deviceId, readOnly, ...(relay ? { relay } : {}) }),
    close: (code: number, reason: string) => log.push(`closed ${code} ${reason}`),
    getBufferedAmount: () => 0,
    send: (text: string) => { messages.push(JSON.parse(text)); return 1; },
  } as unknown as Client;
  const clients = new Set<Client>([client]);
  const present = new Set<Client>([client]);
  const connections = createConnections({
    clients, present, pending, devices,
    detachClaimed: () => log.push("detach claimed"),
    dropClaims: () => log.push("drop claims"),
  });
  return { client, clients, present, log, messages, revoke: () => revocations.forEach((close) => close()), ...connections };
}

it("refuses core watches before any CLI or attach is spawned, even for a stale client request", () => {
  const previous = process.env["HERDR_SOCKET"];
  const socket = `/private/${"long-checkout/".repeat(12)}herdr-core.sock`;
  const lookup = spyOn(coreRuntime, "coreConnectionForSocket").mockImplementation((path) => path === socket ? {} as HcConnection : null);
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => { throw new Error("must not spawn"); });
  try {
    process.env["HERDR_SOCKET"] = socket;
    expect(paneWatchSupported()).toBe(false);
    expect(paneWatchSupported("/old-herdr.sock")).toBe(true);
    const h = harness({ readOnly: true });
    h.watchPane(h.client, "t1", { cols: 10, rows: 5 });
    h.watchPane(h.client, "t1", { cols: 20, rows: 8 });
    expect(h.messages).toEqual([{ type: "watch-end", pane_id: "t1" }, { type: "watch-end", pane_id: "t1" }]);
    expect(spawn).not.toHaveBeenCalled();
    expect(h.client.data.attached.size).toBe(0);
    expect(h.mayType(h.client)).toBe(false);
  } finally {
    spawn.mockRestore(); lookup.mockRestore();
    if (previous === undefined) delete process.env["HERDR_SOCKET"]; else process.env["HERDR_SOCKET"] = previous;
  }
});

it("retains the old runtime's read-only observe command and exact socket", () => {
  const previous = process.env["HERDR_SOCKET"];
  const lookup = spyOn(coreRuntime, "coreConnectionForSocket").mockReturnValue(null);
  // Refuse the fake launch synchronously: never invoke the installed CLI in a unit check.
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => { throw new Error("fixture launch stopped"); });
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  try {
    process.env["HERDR_SOCKET"] = "/private/old-herdr.sock";
    expect(paneWatchSupported()).toBe(true);
    const h = harness();
    h.watchPane(h.client, "t2", { cols: 80, rows: 24 });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[0]).toEqual([process.env["HERDR_WEB_HERDR_BIN"] || "herdr", "terminal", "session", "observe", "t2", "--cols", "80", "--rows", "24"]);
    expect(spawn.mock.calls[0]?.[1]).toMatchObject({ stdin: "ignore", env: { HERDR_SOCKET_PATH: "/private/old-herdr.sock" } });
    expect(h.messages).toEqual([{ type: "watch-end", pane_id: "t2" }]);
  } finally {
    warning.mockRestore(); spawn.mockRestore(); lookup.mockRestore();
    if (previous === undefined) delete process.env["HERDR_SOCKET"]; else process.env["HERDR_SOCKET"] = previous;
  }
});

it("a stall ends the connection once and leaves its presence to the socket's close", () => {
  const { client, clients, present, log, end } = harness();
  end(client, "stalled");
  end(client, "stalled");
  expect(log).toEqual(["pending closed", "detach claimed", "drop claims", `closed ${OUTPUT_STALLED_CLOSE_CODE} terminal output consumer stalled`]);
  expect(clients.has(client)).toBe(false);
  expect(present.has(client)).toBe(true);
  expect(send(client, { type: "session-changed" })).toBe(0);
  end(client, "closed");
  expect(present.has(client)).toBe(false);
});

it("a revoke ends the connection with 1008 and leaves its pending input to the socket's close", () => {
  const { client, clients, present, log, admit, revoke, end, mayType, authorizeSocket } = harness({ deviceId: "phone" });
  expect(admit(client)).toBe(true);
  expect(mayType(client)).toBe(true);
  revoke();
  expect(log).toEqual(["detach claimed", "drop claims", "closed 1008 Device access revoked"]);
  expect(clients.has(client) || present.has(client)).toBe(false);
  expect(mayType(client)).toBe(false);
  expect(() => authorizeSocket(client)).toThrow("this device's access was revoked");
  end(client, "closed");
  expect(log.slice(3)).toEqual(["unwatch device", "pending closed", "detach claimed", "drop claims"]);
});

it("does not admit a device that was revoked before its socket opened", () => {
  const { client, log, admit } = harness({ deviceId: "phone", revokedAlready: true });
  expect(admit(client)).toBe(false);
  expect(log.at(-1)).toBe("closed 1008 Device access revoked");
});

it("closes only the relay of a relayed connection", () => {
  const relayed: string[] = [];
  const relay = { close: () => relayed.push("relay closed") } as unknown as MachineRelay;
  const { client, present, log, end } = harness({ relay });
  end(client, "closed");
  expect(relayed).toEqual(["relay closed"]);
  expect(log).toEqual([]);
  expect(present.has(client)).toBe(false);
});

it("counts each change of role, and a read-only connection only watches", () => {
  const { client, setRole, mayType } = harness();
  setRole(client, "interact");
  expect(connectionOf(client).roles).toBe(0);
  setRole(client, "observe");
  setRole(client, "interact");
  expect(connectionOf(client)).toMatchObject({ mode: "interact", roles: 2 });
  expect(mayType(client)).toBe(true);
  const watcher = harness({ readOnly: true });
  expect(connectionOf(watcher.client).mode).toBe("observe");
  expect(() => watcher.authorizeSocket(watcher.client)).toThrow("this connection can only watch");
});
