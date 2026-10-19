import { describe, expect, test } from "bun:test";
import { forkCapabilityGate, forkRequestGate } from "./fork-policy.ts";
import { forkBrowserReplacer, jsonResponse } from "./http.ts";

const policy = {
  port: 8787,
  tailnetHost: "owner.tail-test.ts.net",
  ownerLogin: "owner@example.test",
};
const req = (
  path = "/api/session",
  headers: Record<string, string> = {},
  method = "GET",
) =>
  new Request(`http://127.0.0.1:8787${path}`, {
    method,
    headers: { host: "127.0.0.1:8787", ...headers },
  });

describe("fork ingress before route side effects", () => {
  test("local read works, but arbitrary Host and non-loopback peers do not", () => {
    expect(forkRequestGate(req(), true, policy)).toBeNull();
    expect(forkRequestGate(req(), false, policy)?.status).toBe(403);
    expect(
      forkRequestGate(req("/", { host: "attacker.test" }), true, policy)
        ?.status,
    ).toBe(403);
  });
  test("mutation and websocket require exact Origin, even without cookies", () => {
    for (const [path, method] of [
      ["/api/pane/input", "POST"],
      ["/ws", "GET"],
    ]) {
      expect(forkRequestGate(req(path, {}, method), true, policy)?.status).toBe(
        403,
      );
      expect(
        forkRequestGate(
          req(path, { origin: "http://attacker.test" }, method),
          true,
          policy,
        )?.status,
      ).toBe(403);
      expect(
        forkRequestGate(
          req(path, { origin: "http://127.0.0.1:8787" }, method),
          true,
          policy,
        ),
      ).toBeNull();
    }
  });
  test("spoofed forwarded identity cannot upgrade local ingress", () => {
    expect(
      forkRequestGate(
        req("/api/session", { "tailscale-user-login": policy.ownerLogin }),
        true,
        policy,
      )?.status,
    ).toBe(403);
  });
  test("verified private route needs configured owner and one private source", () => {
    const headers = {
      host: policy.tailnetHost,
      "tailscale-user-login": policy.ownerLogin,
      "x-forwarded-for": "100.70.1.2",
      "x-forwarded-proto": "https",
      origin: `https://${policy.tailnetHost}`,
    };
    expect(
      forkRequestGate(req("/api/session", headers), true, policy),
    ).toBeNull();
    for (const patch of [
      { "tailscale-user-login": "other@example.test" },
      { "x-forwarded-for": "203.0.113.1" },
      { "x-forwarded-for": "100.70.1.2, 100.70.1.3" },
      { "tailscale-funnel-request": "1" },
    ] as Record<string, string>[]) {
      expect(
        forkRequestGate(
          req("/api/session", { ...headers, ...patch }),
          true,
          policy,
        )?.status,
      ).toBe(403);
    }
  });
});

test("absent telemetry is the source client's null capability without collection", async () => {
  const response = forkCapabilityGate(req("/api/telemetry"), false);
  expect(response?.status).toBe(200);
  expect(response?.headers.get("cache-control")).toBe("no-store");
  expect(await response!.json()).toBeNull();
  // An installed service and mutations still belong to the source handler.
  expect(forkCapabilityGate(req("/api/telemetry"), true)).toBeNull();
  expect(
    forkCapabilityGate(req("/api/telemetry", {}, "POST"), false),
  ).toBeNull();
});

test("unapproved external capabilities are refused, not fake successful responses", async () => {
  for (const path of [
    "/api/usage/login",
    "/api/portal/start",
    "/api/herdr/update",
    "/api/updates/install",
    "/api/voice/transcribe",
    "/api/plugin/action",
    "/api/machines/setup",
  ]) {
    const response = forkCapabilityGate(req(path, {}, "POST"));
    expect(response?.status).toBe(403);
    expect((await response!.json()).error.code).toBe(
      "capability_requires_approval",
    );
  }
  expect(forkCapabilityGate(req("/api/usage?refresh=1"))?.status).toBe(403);
  expect(forkCapabilityGate(req("/api/session"))).toBeNull();
  expect(
    forkCapabilityGate(req("/api/machines/local/pane/input", {}, "POST")),
  ).toBeNull();
  expect(forkCapabilityGate(req("/api/usage"))).toBeNull();
});

test("HTTP and WS/SSE serialization keep presentation tokens but never native identity", async () => {
  const before = process.env["HERDR_WEB_FORK_PRIVACY"];
  try {
    process.env["HERDR_WEB_FORK_PRIVACY"] = "1";
    const tokens = {
      summary: "Readable status",
      progress: "50%",
      agent_session_id: "private-session",
      auth_token: "private-credential",
      unknown: "private-new-field",
      quota: "bad\u0000control",
    };
    const value = {
      panes: [
        {
          tokens,
          agent_session: {
            agent: "codex",
            kind: "id",
            value: "private-provider-session",
          },
          state_labels: { opaque: "private-native-label" },
        },
      ],
      token: "separate auth contract",
    };
    const expected = {
      panes: [{ tokens: { summary: "Readable status", progress: "50%" } }],
      token: "separate auth contract",
    };
    expect(JSON.parse(JSON.stringify(value, forkBrowserReplacer))).toEqual(
      expected,
    );
    expect(await jsonResponse(value).json()).toEqual(expected);
    expect(tokens.agent_session_id).toBe("private-session");
    delete process.env["HERDR_WEB_FORK_PRIVACY"];
    expect(JSON.parse(JSON.stringify(value, forkBrowserReplacer))).toEqual(
      value,
    );
  } finally {
    if (before === undefined) delete process.env["HERDR_WEB_FORK_PRIVACY"];
    else process.env["HERDR_WEB_FORK_PRIVACY"] = before;
  }
});
