# Local and remote PCs

The source application has machine-aware navigation, but **remote-PC mutations are not enabled in this fork**. Local PC functionality remains available. A remote row, saved profile or visible setup control does not grant permission to open SSH, install a bridge or update a remote host.

## Current fork behavior

`server/fork-policy.ts` blocks mutations below nonlocal `/api/machines/` routes before setup/connection/update handlers. Saved remote autoconnect and bridge autoupdate are disabled at construction. Existing local machine operations are not blanket-disabled by that policy. Read-only inventory or cached remote state must not be confused with a live, authorized connection.

Do not follow upstream “Install and connect,” key-registration, remote bundle or automatic-update recipes to bypass this boundary. New SSH connections, host-key trust, credentials, remote writes and runtime installation need an explicit future scope and evidence. This document is a protocol map, not activation instructions.

## Source protocol map

The adopted design is:

```text
Browser → connection server → SSH loopback forward → remote bridge → native Herdr socket
```

The browser does not run SSH. Source modules retain the machine roster, security checks, setup jobs and relay implementation:

| Concern                                   | Source owner                                          |
| ----------------------------------------- | ----------------------------------------------------- |
| Catalog and machine lifecycle             | `server/machines.ts`, `server/herdr-profile-state.ts` |
| HTTP routing and serialized machine state | `server/machine-api.ts`                               |
| Destination/security validation           | `server/machine-security.ts`, `server/ssh.ts`         |
| Bridge/relay                              | `server/bridge.ts`, `server/machine-relay.ts`         |
| Runtime identity and bundles              | `server/remote-entry.ts`, `server/remote-bundle.ts`   |
| Client machine selection                  | `src/components/MachineSidebar.tsx`                   |

Source `GET /api/machines` and `/api/machines/events` describe roster/status. Machine-targeted routes and `/ws?machine_id=…` bind traffic to a selected destination. Source role, same-origin and authentication checks remain relevant underneath the fork gate; existence of those endpoints does not enable setup POSTs or prove a remote host works.

Terminal attachments have immutable machine targets. Cached screens, drafts and pending rows must retain their machine/pane identity. Reconnection must not select another target, take over a terminal or send held input automatically.

## Platform limits

Upstream describes SSH runtimes for Linux, macOS and Windows, including Windows screen mirroring when native terminal attach is unavailable. Those are source capabilities, not fork deployment certification. WSL connects to a Linux environment, not the same native Windows session; it is not a fallback that proves Windows support.

The fork's native Windows bootstrap/NTFS fixtures passed CI, while actual Windows Herdr-host startup remains unverified. That local-launch distinction is separate from remote SSH setup being blocked. See [Installation](../INSTALL.md#platform-and-private-state-limits) and [coverage](upstream-parity.md).

For detailed historical upstream protocol behavior, use the [pinned remote-PC reference](https://github.com/devswha/herdr-web-ui/blob/d918448647e41079c52047ffc96cdaac50ccba32/docs/remote-pcs.md). Its installers and defaults do not override this fork's policy. [Security](../SECURITY.md) owns the access boundary; [Development](development.md) owns opt-in testing rules.
