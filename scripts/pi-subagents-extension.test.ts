import { expect, it } from "bun:test";
import observer from "./pi-subagents-extension.ts";

it("retains only a non-writing migration command, never a second lifecycle producer", async () => {
  const names: string[] = [];
  let handler!: (args: string, ctx: any) => Promise<void>;
  const notices: string[] = [];
  observer({ registerCommand(name, command) { names.push(name); handler = command.handler; } });
  expect(names).toEqual(["herdr-web-observer"]);
  await handler("start", { ui: { notify: (s: string) => notices.push(s) } });
  expect(notices[0]).toContain("no longer publishes");
  expect(notices[0]).toContain("No per-session start");
});
