import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createECDH } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  preparePrivateRuntimeTree,
  readPrivateConfiguration,
} from "./private-filesystem.ts";
import { preservePushIdentity } from "./run-local.ts";

// Fixture-only ACL mutations, never accepted as production authority. This code
// runs only against a freshly-owned TEMP subtree; no HOME or native host access.
const fixtureScript = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$r = [Console]::In.ReadToEnd() | ConvertFrom-Json
$p = [string]$r.path
$directory = [IO.Directory]::Exists($p)
if ($r.operation -eq 'sddl') {
  if ($directory) { $acl = [IO.Directory]::GetAccessControl($p) } else { $acl = [IO.File]::GetAccessControl($p) }
  [Console]::Write($acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All))
  exit
}
if ($directory) { $acl = [Security.AccessControl.DirectorySecurity]::new() } else { $acl = [Security.AccessControl.FileSecurity]::new() }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
foreach ($id in @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')) {
  $inheritance = 'ContainerInherit, ObjectInherit'
  if ($r.operation -eq 'noinherit') { $inheritance = 'None' }
  if ($directory) { $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($id), 'FullControl', $inheritance, 'None', 'Allow') }
  else { $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($id), 'FullControl', 'Allow') }
  $acl.AddAccessRule($rule)
}
if ($r.operation -notin @('private', 'noinherit')) {
  $who = 'S-1-1-0'
  if ($r.operation -eq 'users') { $who = 'S-1-5-32-545' }
  $kind = 'Allow'
  if ($r.operation -eq 'deny') { $kind = 'Deny' }
  $rights = 'Read'
  if ($r.operation -eq 'replace') { $rights = 'DeleteSubdirectoriesAndFiles' }
  if ($r.operation -eq 'deny') { $rights = 'WriteData' }
  if ($directory) { $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($who), $rights, 'ContainerInherit, ObjectInherit', 'None', $kind) }
  else { $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($who), $rights, $kind) }
  $acl.AddAccessRule($rule)
}
if ($directory) { [IO.Directory]::SetAccessControl($p, $acl) } else { [IO.File]::SetAccessControl($p, $acl) }
`;
function fixtureAcl(path: string, operation: string): string {
  return execFileSync(
    join(
      process.env["SystemRoot"]!,
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(fixtureScript, "utf16le").toString("base64"),
    ],
    {
      input: JSON.stringify({ path, operation }),
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    },
  );
}
function fixture(run: (root: string, state: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "herdr privacy ' &; % Unicode-ไทย-"));
  const before = process.env["HERDR_WEB_PUSH_SUBJECT"];
  try {
    fixtureAcl(root, "private");
    const state = join(root, "state");
    preparePrivateRuntimeTree(state); // Actual production worker, no mock flags.
    run(root, state);
  } finally {
    if (before === undefined) delete process.env["HERDR_WEB_PUSH_SUBJECT"];
    else process.env["HERDR_WEB_PUSH_SUBJECT"] = before;
    rmSync(root, { recursive: true, force: true });
  }
}

test.if(process.platform === "win32")(
  "native NTFS private creation and file/subdirectory/rename inheritance",
  () =>
    fixture((_root, state) => {
      mkdirSync(join(state, "nested"));
      writeFileSync(join(state, "nested/config.json"), '{"native":true}');
      expect(
        readPrivateConfiguration(join(state, "nested/config.json")),
      ).toEqual({ native: true });
      preparePrivateRuntimeTree(state); // Includes production inheritance/rename witnesses.
      expect(readPrivateConfiguration(join(state, "missing.json"))).toBeNull();
    }),
  120_000,
);

test.if(process.platform === "win32")(
  "native config rejects Everyone, Users, deny and unsafe existing descendants without repairing",
  () =>
    fixture((root, state) => {
      const config = join(state, "legacy.json");
      writeFileSync(config, '{"kept":true}');
      for (const operation of ["everyone", "users", "deny"]) {
        fixtureAcl(config, operation);
        const before = fixtureAcl(config, "sddl");
        expect(() => readPrivateConfiguration(config)).toThrow();
        expect(() => preparePrivateRuntimeTree(state)).toThrow();
        expect(fixtureAcl(config, "sddl")).toBe(before);
        expect(readFileSync(config, "utf8")).toBe('{"kept":true}');
        fixtureAcl(config, "private");
      }
      const inherited = join(state, "inherited");
      mkdirSync(inherited);
      fixtureAcl(inherited, "everyone");
      const inheritedConfig = join(inherited, "config.json");
      writeFileSync(inheritedConfig, '{"kept":true}');
      expect(() => readPrivateConfiguration(inheritedConfig)).toThrow();
      expect(() => preparePrivateRuntimeTree(state)).toThrow();
      fixtureAcl(inherited, "private");
      fixtureAcl(inheritedConfig, "private");
      fixtureAcl(root, "replace");
      expect(() => readPrivateConfiguration(config)).toThrow("ancestor");
      fixtureAcl(root, "private");
    }),
  120_000,
);

test.if(process.platform === "win32")(
  "every existing runtime directory must preserve future private inheritance",
  () =>
    fixture((_root, state) => {
      const child = join(state, "private-but-noninheriting");
      mkdirSync(child);
      fixtureAcl(child, "noinherit");
      const before = fixtureAcl(child, "sddl");
      expect(() => preparePrivateRuntimeTree(state)).toThrow("inheritable");
      expect(fixtureAcl(child, "sddl")).toBe(before);
    }),
  120_000,
);

test.if(process.platform === "win32")(
  "native junctions are refused without following or changing their targets",
  () =>
    fixture((root, state) => {
      const target = join(root, "target");
      mkdirSync(target);
      writeFileSync(join(target, "kept"), "unchanged");
      const junction = join(state, "junction");
      try {
        symlinkSync(target, junction, "junction");
        expect(() => preparePrivateRuntimeTree(state)).toThrow("Reparse");
        expect(readFileSync(join(target, "kept"), "utf8")).toBe("unchanged");
      } finally {
        rmSync(junction);
      }
    }),
  120_000,
);

test.if(process.platform === "win32")(
  "native Push preserves bytes, ACLs, keys and exclusive destination behavior",
  () =>
    fixture((root, state) => {
      const config = join(root, "legacy.json");
      const curve = createECDH("prime256v1");
      curve.generateKeys();
      const pair = {
        publicKey: curve.getPublicKey().toString("base64url"),
        privateKey: curve.getPrivateKey().toString("base64url"),
      };
      writeFileSync(
        config,
        JSON.stringify({ ...pair, subject: "mailto:fixture@example.invalid" }),
      );
      const bytes = readFileSync(config);
      const acl = fixtureAcl(config, "sddl");
      expect(preservePushIdentity(state, config)).toBe(true);
      expect(
        JSON.parse(readFileSync(join(state, "vapid.json"), "utf8")),
      ).toEqual(pair);
      expect(preservePushIdentity(state, config)).toBe(true);
      expect(readFileSync(config)).toEqual(bytes);
      expect(fixtureAcl(config, "sddl")).toBe(acl);
      expect(existsSync(join(state, "push-subscriptions.json"))).toBe(false);
      for (const invalid of [
        " ".repeat(16_385),
        "not-json",
        "[]",
        JSON.stringify({
          publicKey: "bad",
          privateKey: "bad",
          subject: "mailto:x@example.invalid",
        }),
      ]) {
        writeFileSync(config, invalid);
        expect(() => preservePushIdentity(state, config)).toThrow();
        expect(readFileSync(config, "utf8")).toBe(invalid);
        expect(fixtureAcl(config, "sddl")).toBe(acl);
      }
      curve.generateKeys();
      writeFileSync(
        config,
        JSON.stringify({
          publicKey: curve.getPublicKey().toString("base64url"),
          privateKey: curve.getPrivateKey().toString("base64url"),
          subject: "mailto:fixture@example.invalid",
        }),
      );
      const destination = join(state, "vapid.json");
      const saved = readFileSync(destination);
      expect(() => preservePushIdentity(state, config)).toThrow("differs");
      expect(readFileSync(destination)).toEqual(saved);
      rmSync(config);
      expect(preservePushIdentity(state, config)).toBe(false);
      expect(readFileSync(destination)).toEqual(saved);
    }),
  120_000,
);
