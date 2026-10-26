import { describe, expect, it } from "bun:test";
import type { ConversationPart } from "../../shared/protocol.ts";
import { cachedImageRef, LINE_IMAGES_SHOWN, lineImages, linePictures, workImages } from "./workImages.ts";

type ToolPart = Extract<ConversationPart, { kind: "tool" }>;
const tool = (name: string, refs: string[]): ToolPart => ({
  kind: "tool", name, summary: "", input: "{}", output: "",
  ...(refs.length > 0 ? { images: refs.map((ref) => ({ media_type: "image/png", ref })) } : {}),
});

describe("workImages", () => {
  it("lists every tool picture in work order and numbers each tool's own images", () => {
    const read = tool("Read", ["a:0:0"]);
    const shots = tool("screenshot", ["b:0:0", "b:0:1"]);
    const parts: ConversationPart[] = [read, { kind: "text", text: "looking" }, tool("Bash", []), shots];
    expect(workImages(parts).map((image) => [image.part.name, image.ref, image.ordinal])).toEqual([
      ["Read", "a:0:0", 0], ["screenshot", "b:0:0", 0], ["screenshot", "b:0:1", 1],
    ]);
    expect(workImages(parts)[1]!.part).toBe(shots);
  });

  it("finds none when tools returned no pictures", () => {
    expect(workImages([tool("Bash", []), { kind: "thinking", text: "hm" }])).toEqual([]);
  });
});

describe("cachedImageRef", () => {
  const claude = "6f1c2a9e-4b7d-4e2a-9c1f-0a2b3c4d5e6f:3:1";

  it("allows immutable Claude and Pi refs on the work line", () => {
    expect(cachedImageRef(claude)).toBe(true);
    expect(cachedImageRef("pi:call_7:0")).toBe(true);
    expect(cachedImageRef("pi-prompt:entry-12:1")).toBe(true);
  });

  it("leaves mutable or unknown refs inside opened details", () => {
    expect(cachedImageRef(`codex-${"ab".repeat(32)}`)).toBe(false);
    expect(cachedImageRef("opencode:msg_01HZY8K2:0")).toBe(false);
    expect(cachedImageRef("grok:turn-3:0")).toBe(false);
  });

  it("keeps only safe line pictures in work order", () => {
    const parts = [tool("Read", [claude]), tool("view_image", ["codex-file"]), tool("read", ["pi:call_7:0", "opencode:row:0"])];
    expect(linePictures(parts).map((image) => image.ref)).toEqual([claude, "pi:call_7:0"]);
  });
});

describe("lineImages", () => {
  it("shows all pictures up to the limit", () => {
    expect(lineImages([1, 2, 3, 4])).toEqual({ hidden: 0, shown: [1, 2, 3, 4] });
    expect(lineImages([])).toEqual({ hidden: 0, shown: [] });
  });

  it("shows the latest pictures and counts earlier ones", () => {
    const ten = Array.from({ length: 10 }, (_, index) => index);
    expect(lineImages(ten)).toEqual({ hidden: 10 - LINE_IMAGES_SHOWN, shown: ten.slice(10 - LINE_IMAGES_SHOWN) });
    expect(lineImages([1, 2, 3], 2)).toEqual({ hidden: 1, shown: [2, 3] });
  });
});
