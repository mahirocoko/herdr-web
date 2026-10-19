import { isIP, BlockList } from "node:net";
import { jsonResponse } from "./http.ts";

/** Fork ingress policy runs before source auth, cookie confirmation or route side effects. */
export interface ForkPolicy {
  port: number;
  tailnetHost?: string;
  ownerLogin?: string;
}

const tailnet = new BlockList();
tailnet.addSubnet("100.64.0.0", 10, "ipv4");
tailnet.addSubnet("fd7a:115c:a1e0::", 48, "ipv6");
const deny = (code: string, message: string) =>
  jsonResponse({ error: { code, message } }, 403, {
    "cache-control": "no-store",
  });

export function forkRequestGate(
  request: Request,
  loopback: boolean,
  policy: ForkPolicy,
): Response | null {
  const url = new URL(request.url);
  const host = request.headers.get("host")?.toLowerCase();
  const local =
    host === `127.0.0.1:${policy.port}` || host === `localhost:${policy.port}`;
  const remote = !!policy.tailnetHost && host === policy.tailnetHost;
  if (!loopback || (!local && !remote))
    return deny(
      "invalid_host",
      "Use this installation's local or verified private address",
    );
  const proxyHeaders = [
    "forwarded",
    "via",
    "x-real-ip",
    "x-forwarded-host",
    "x-forwarded-for",
    "x-forwarded-proto",
    "tailscale-user-login",
    "tailscale-funnel-request",
  ];
  if (local && proxyHeaders.some((name) => request.headers.has(name)))
    return deny(
      "untrusted_proxy",
      "Forwarded identity is not accepted on the local address",
    );
  if (remote) {
    const address = request.headers.get("x-forwarded-for") ?? "";
    const family = isIP(address);
    const privateSource =
      family === 4
        ? tailnet.check(address, "ipv4")
        : family === 6 && tailnet.check(address, "ipv6");
    if (
      !privateSource ||
      request.headers.has("tailscale-funnel-request") ||
      !policy.ownerLogin ||
      request.headers.get("tailscale-user-login")?.toLowerCase() !==
        policy.ownerLogin.toLowerCase() ||
      request.headers.get("x-forwarded-proto") !== "https" ||
      request.headers.has("forwarded") ||
      request.headers.has("via")
    ) {
      return deny(
        "owner_required",
        "Only the configured private-network owner may use this installation",
      );
    }
  }
  const expected = `${remote ? "https" : "http"}://${host}`;
  const origin = request.headers.get("origin");
  const websocket = url.pathname === "/ws";
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const site = request.headers.get("sec-fetch-site");
  if (
    (site && site !== "same-origin" && site !== "none") ||
    (origin !== null && origin !== expected) ||
    ((websocket || mutation) && origin === null)
  ) {
    return deny("invalid_origin", "Use controls from this app");
  }
  return null;
}

/** Report absent fork capabilities and refuse external effects before their handlers. */
export function forkCapabilityGate(
  request: Request,
  telemetryAvailable = false,
): Response | null {
  const url = new URL(request.url);
  const path = url.pathname;
  // The source client represents unavailable telemetry as null and hides its controls.
  // Report that absence without a browser resource error, collector, or persistence.
  if (
    path === "/api/telemetry" &&
    request.method === "GET" &&
    !telemetryAvailable
  )
    return jsonResponse(null, 200, { "cache-control": "no-store" });
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  let capability: string | null = null;
  if (path === "/api/usage/login") capability = "account sign-in";
  if (path === "/api/usage" && url.searchParams.get("refresh") === "1")
    capability = "credential-backed forced usage refresh";
  if (path.startsWith("/api/cliproxy")) capability = "account proxy";
  if (path.startsWith("/api/voice") && mutation)
    capability = "paid voice transcription or key configuration";
  if (
    (path.startsWith("/api/updates") && mutation) ||
    (path === "/api/herdr/update" && mutation)
  )
    capability = "managed updates";
  if (path.startsWith("/api/portal") && mutation)
    capability = "public exposure";
  if (path === "/api/plugin/action" && mutation)
    capability = "global plugin actions";
  if (
    path.startsWith("/api/machines/") &&
    !path.startsWith("/api/machines/local/") &&
    mutation
  )
    capability = "remote PC setup, connection or updates";
  return capability
    ? deny(
        "capability_requires_approval",
        `${capability} is not enabled for this fork. Existing accounts and configuration are unchanged.`,
      )
    : null;
}
