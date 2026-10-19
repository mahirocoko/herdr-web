import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentMark, hasBrandColors } from "./AgentMark.tsx";

describe("agent marks", () => {
  it("uses the complete locally vendored Letta organization image at the requested size", () => {
    const html = renderToStaticMarkup(
      createElement(AgentMark, { agent: "letta", size: 24 }),
    );
    expect(html).toContain('src="/icons/letta-webclip.png"');
    expect(html).toContain('width="24" height="24" alt="letta"');
    expect(html).not.toContain("<text");
    const image = readFileSync(
      new URL("../../public/icons/letta-webclip.png", import.meta.url),
    );
    expect(createHash("sha256").update(image).digest("hex")).toBe(
      "19564f266ec4e5628ecafc936cfe2ba0f8633e4959feded7ddf4000abf6c6508",
    );
    expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([
      256, 256,
    ]);
  });
  it("tells the marks with brand colors from those riding currentColor, for Mono to grey only the former", () => {
    expect(["claude", "omp", "opencode", "gjc", "omo", "amp", "gemini"].every(hasBrandColors)).toBe(true);
    expect(["codex", "cursor", "cline", "pi", "unknown-agent"].some(hasBrandColors)).toBe(false);
    expect(renderToStaticMarkup(createElement(AgentMark, { agent: "claude" }))).toContain('class="agent-mark claude is-brand"');
    expect(renderToStaticMarkup(createElement(AgentMark, { agent: "codex" }))).toContain('class="agent-mark codex"');
    expect(renderToStaticMarkup(createElement(AgentMark, { agent: "zed" }))).toContain('class="agent-mark zed"');
  });
});
