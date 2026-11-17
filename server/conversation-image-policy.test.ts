import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fileView from "./file-view.ts";

const original = await import("./conversation.ts");
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
let image: { bytes: Uint8Array; mediaType: string } | null = null;
const reads: string[][] = [];
mock.module("./conversation.ts", () => ({ ...original, conversationImage: async (pane: string, ref: string) => { reads.push([pane, ref]); return image; } }));
const { handlePaneRequest } = await import("./pane-routes.ts");
const policy = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";
const root = mkdtempSync(join(tmpdir(), "herdr-image-policy-"));
afterAll(() => { mock.restore(); rmSync(root, { recursive: true, force: true }); });
beforeEach(() => { image = { bytes: png, mediaType: "image/png" }; reads.length = 0; });
async function ask(ref: string, pane = "fictional-pane"): Promise<Response> {
  const url = new URL("http://127.0.0.1/api/pane/conversation/image");
  if (pane) url.searchParams.set("pane_id", pane);
  if (ref) url.searchParams.set("ref", ref);
  return (await handlePaneRequest(new Request(url), url, url.pathname, {}))!;
}

test("conversation pictures share the unchanged non-PDF file content policy", async () => {
  const path = join(root, "picture.png");
  writeFileSync(path, png);
  const file = fileView.fileResponse(fileView.fileInfo(path)!, false);
  expect(file.headers.get("content-security-policy")).toBe(policy);
  expect((fileView as typeof fileView & { FILE_POLICY?: string }).FILE_POLICY).toBe(policy);
  const response = await ask("pi:fictional-call:0");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-security-policy")).toBe(file.headers.get("content-security-policy"));
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  expect(reads).toEqual([["fictional-pane", "pi:fictional-call:0"]]);
});

for (const ref of ["claude:fictional-image", "pi:fictional-call:0", "codex-input:fictional", "opencode:fictional"]) {
  test(`${ref}: content policy preserves the image reference's cache contract`, async () => {
    const response = await ask(ref);
    expect(response.headers.get("content-security-policy")).toBe(policy);
    expect(response.headers.get("cache-control")).toBe(ref.startsWith("codex-") || ref.startsWith("opencode:") ? "private, no-store" : "private, max-age=86400, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
}

test("missing parameters do not reach image resolution; missing images remain JSON 404", async () => {
  expect((await ask("", "fictional-pane")).status).toBe(400);
  expect((await ask("pi:fictional-call:0", "")).status).toBe(400);
  expect(reads).toEqual([]);
  image = null;
  const response = await ask("pi:missing:0");
  expect(response.status).toBe(404);
  expect(response.headers.get("content-type")).toStartWith("application/json");
  expect(await response.json()).toMatchObject({ error: { code: "image_not_found" } });
});
