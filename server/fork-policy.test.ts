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
  test("observed Android empty-destination navigation is not a general fetch exception", () => {
    const navigation = {
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "empty",
    };
    expect(forkRequestGate(req("/", navigation), true, policy)).toBeNull();
    const remote = {
      ...navigation,
      host: policy.tailnetHost,
      "tailscale-user-login": policy.ownerLogin,
      "x-forwarded-for": "100.70.1.2",
      "x-forwarded-proto": "https",
    };
    expect(forkRequestGate(req("/", remote), true, policy)).toBeNull();
    expect(
      forkRequestGate(
        req("/", { ...remote, "tailscale-user-login": "other@example.test" }),
        true,
        policy,
      )?.status,
    ).toBe(403);
    expect(
      forkRequestGate(
        req("/", { ...remote, "x-forwarded-for": "203.0.113.1" }),
        true,
        policy,
      )?.status,
    ).toBe(403);
    expect(
      forkRequestGate(
        req("/", { ...remote, "tailscale-funnel-request": "1" }),
        true,
        policy,
      )?.status,
    ).toBe(403);
    for (const path of ["/api/session", "/api/fs/file", "/ws", "/index.html"]) {
      expect(forkRequestGate(req(path, navigation), true, policy)?.status).toBe(
        403,
      );
    }
    for (const mode of ["cors", "no-cors", "same-origin", ""]) {
      expect(
        forkRequestGate(
          req("/", { ...navigation, "sec-fetch-mode": mode }),
          true,
          policy,
        )?.status,
      ).toBe(403);
    }
    for (const origin of ["null", "https://attacker.test"]) {
      expect(
        forkRequestGate(req("/", { ...navigation, origin }), true, policy)
          ?.status,
      ).toBe(403);
    }
    expect(
      forkRequestGate(req("/", navigation, "POST"), true, policy)?.status,
    ).toBe(403);
    expect(
      forkRequestGate(
        req("/", { ...navigation, host: "attacker.test" }),
        true,
        policy,
      )?.status,
    ).toBe(403);
    expect(forkRequestGate(req("/", navigation), false, policy)?.status).toBe(
      403,
    );
  });

  test("Android-style cross-site root document launch preserves all other boundaries", () => {
    const navigation = {
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    };
    expect(forkRequestGate(req("/", navigation), true, policy)).toBeNull();
    expect(
      forkRequestGate(req("/?workspace=test", navigation), true, policy),
    ).toBeNull();
    for (const path of [
      "/api/session",
      "/api/fs/file",
      "/ws",
      "/manifest.webmanifest",
    ]) {
      expect(forkRequestGate(req(path, navigation), true, policy)?.status).toBe(
        403,
      );
    }
    for (const headers of [
      { ...navigation, origin: "https://attacker.test" },
      { ...navigation, origin: "null" },
      { ...navigation, "sec-fetch-mode": "cors" },
      { ...navigation, "sec-fetch-dest": "iframe" },
      { ...navigation, "sec-fetch-site": "unknown" },
      { ...navigation, host: "attacker.test" },
      { ...navigation, "tailscale-user-login": policy.ownerLogin },
    ]) {
      expect(forkRequestGate(req("/", headers), true, policy)?.status).toBe(
        403,
      );
    }
    for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
      expect(
        forkRequestGate(req("/", navigation, method), true, policy)?.status,
      ).toBe(403);
    }
    expect(forkRequestGate(req("/", navigation), false, policy)?.status).toBe(
      403,
    );
    const remote = {
      ...navigation,
      host: policy.tailnetHost,
      "tailscale-user-login": policy.ownerLogin,
      "x-forwarded-for": "100.70.1.2",
      "x-forwarded-proto": "https",
    };
    expect(forkRequestGate(req("/", remote), true, policy)).toBeNull();
    const remoteFailures: Record<string, string>[] = [
      { "tailscale-user-login": "other@example.test" },
      { "x-forwarded-for": "203.0.113.1" },
      { "tailscale-funnel-request": "1" },
    ];
    for (const patch of remoteFailures) {
      expect(
        forkRequestGate(req("/", { ...remote, ...patch }), true, policy)
          ?.status,
      ).toBe(403);
    }
  });

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
      tasks: [{ tokens: null }, { tokens: 123 }, { tokens: "not-a-count" }, { tokens: -1 }],
    };
    const expected = {
      panes: [{ tokens: { summary: "Readable status", progress: "50%" } }],
      token: "separate auth contract",
      tasks: [{ tokens: null }, { tokens: 123 }, { tokens: {} }, { tokens: {} }],
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
