import { describe, expect, it } from "bun:test";
import { TerminalFitPause } from "./terminalFitPause.ts";

describe("fitted terminal pause lifetime", () => {
  it("releases once, invalidates old output, and resumes with a fresh attachment only", () => {
    const gate = new TerminalFitPause();
    const calls: string[] = [];
    const oldOutput = gate.ticket();
    gate.pause(() => calls.push("detach", "unwatch", "disable-input"));
    gate.pause(() => calls.push("duplicate"));
    expect(gate.paused).toBe(true);
    expect(oldOutput()).toBe(false);
    const pausedOutput = gate.ticket();
    gate.resume(() => calls.push("fresh-attach"));
    expect(gate.paused).toBe(false);
    expect(oldOutput()).toBe(false);
    expect(pausedOutput()).toBe(false);
    expect(gate.ticket()()).toBe(true);
    expect(calls).toEqual([
      "detach",
      "unwatch",
      "disable-input",
      "fresh-attach",
    ]);
  });

  it("pane replacement and unmount invalidate outstanding work without replay", () => {
    const gate = new TerminalFitPause();
    const oldPane = gate.ticket();
    gate.pause(() => {});
    gate.reset();
    let replayed = false;
    gate.resume(() => {
      replayed = true;
    });
    expect(replayed).toBe(false);
    expect(gate.paused).toBe(false);
    expect(oldPane()).toBe(false);
    const unmounted = gate.ticket();
    gate.reset();
    expect(unmounted()).toBe(false);
  });
});
