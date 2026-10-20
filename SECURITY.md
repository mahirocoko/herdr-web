# Security

Herdr Web can read local files and agent transcripts and send input to terminals. An access-control flaw can expose the privileges of the account running it. Test only on systems and accounts you own or have explicit permission to assess.

## Report without publishing details

Use this fork's [Security advisories page](https://github.com/mahirocoko/herdr-web/security/advisories). **Only if GitHub offers “Report a vulnerability” there**, use that private reporting flow. Private vulnerability reporting is not currently enabled; enabling it is a maintainer decision, not a capability this document can promise.

If that option is absent, open a [minimal contact-request issue](https://github.com/mahirocoko/herdr-web/issues/new) asking the maintainer to arrange a private security channel. Include no vulnerability description, reproduction, exploit, logs, tokens or affected private paths. Wait for an agreed private route before sharing details. Do not send this fork's report to upstream, publish a proof in a PR, or assume GitHub issues are confidential. There is no published private email address or guaranteed response time.

Once a private route is agreed, include revision, OS, access path, reproduction and impact. Redact secrets and transcripts. Coordinate disclosure; no release schedule is guaranteed.

## Scope and boundaries

The fork launcher binds loopback. `server/fork-policy.ts` checks Host, peer and Origin before source handlers and cookie writes, including WebSocket and machine traffic. The only accepted private-network route is a verified, configured owner-only Tailscale Serve origin. Public Funnel, arbitrary reverse proxies and public hosting are not supported deployment modes. A bypass of these restrictions is in scope, not excused as an intentionally open server.

Report authentication/authorization bypasses, cross-origin writes, device-role or revocation failures, private identity leakage, file/transcript disclosure, script injection, unsafe private-state handling and Push-key exposure. Remote/update/plugin source remains relevant if a flaw reaches it despite the fork's capability gates. Account sign-in, refresh, paid voice, public exposure, managed updates, plugin actions and remote-PC mutations are blocked, not alternative supported setup paths.

Private state uses restrictive POSIX permissions or native Windows ACL validation. This is a cooperative local boundary: it does not isolate malicious code running as the same user, SYSTEM or an administrator. Authorized terminal users already hold meaningful account authority. Vulnerabilities in Herdr, providers, Tailscale or browsers themselves belong with their respective maintainers; explain any distinct fork impact here.

## Support

Security maintenance targets the current fork source; no maintained older-version matrix or automatic update service is promised. Follow [manual updates](docs/app-updates.md). Windows bootstrap fixtures passing CI do not certify real host startup, and physical PWA/Push receipt remains unverified. See [coverage](docs/upstream-parity.md) for evidence boundaries.
