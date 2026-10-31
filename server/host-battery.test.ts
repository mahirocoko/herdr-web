import { describe, expect, it } from "bun:test";
import { parseHostBattery } from "./host-battery.ts";

describe("host battery parsing", () => {
  it("reads a charging or discharging internal battery", () => {
    expect(parseHostBattery("Now drawing from 'AC Power'\n -InternalBattery-0 (id=123)\t81%; charging; 0:20 remaining")).toEqual({ status: "available", percent: 81, power: "charging" });
    expect(parseHostBattery(" -InternalBattery-0 (id=123)\t17%; discharging; 2:00 remaining")).toEqual({ status: "available", percent: 17, power: "discharging" });
    expect(parseHostBattery(" -InternalBattery-0 (id=123)\t100%; charged; 0:00 remaining")).toEqual({ status: "available", percent: 100, power: "charged" });
    expect(parseHostBattery("Now drawing from 'AC Power'\n -InternalBattery-0 (id=123)\t85%; AC attached; not charging present: true")).toEqual({ status: "available", percent: 85, power: "not-charging" });
    expect(parseHostBattery(" -InternalBattery-0 (id=123)\t99%; finishing charge; 0:01 remaining")).toEqual({ status: "available", percent: 99, power: "charging" });
  });
  it("does not invent a result for absent or malformed batteries", () => {
    for (const output of ["Now drawing from 'AC Power'", " -InternalBattery-0 101%; charging;", " -InternalBattery-0 50%; unknown;"]) expect(parseHostBattery(output)).toEqual({ status: "unavailable" });
  });
});
