import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

// Decode the owned RGBA8 exports directly: no optional renderer/dependency in CI.
function pixels(path: string) {
  const png = readFileSync(resolve(root, "public", path));
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  expect([png[24], png[25], png[28]]).toEqual([8, 6, 0]);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4,
    decoded = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    expect(filter).toBeLessThanOrEqual(4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= 4 ? decoded[i - 4]! : 0;
      const b = y ? decoded[i - stride]! : 0;
      const c = y && x >= 4 ? decoded[i - stride - 4]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      const predictor = [
        0,
        a,
        b,
        Math.floor((a + b) / 2),
        pa <= pb && pa <= pc ? a : pb <= pc ? b : c,
      ][filter]!;
      decoded[i] = (raw[y * (stride + 1) + x + 1]! + predictor) & 255;
    }
  }
  return {
    width,
    height,
    at: (x: number, y: number) => [
      ...decoded.subarray(
        (Math.floor(y) * width + Math.floor(x)) * 4,
        (Math.floor(y) * width + Math.floor(x)) * 4 + 4,
      ),
    ],
  };
}

for (const [path, size, maskable] of [
  ["icons/icon-192.png", 192, false],
  ["icons/icon-512.png", 512, false],
  ["favicon.png", 64, false],
  ["apple-touch-icon.png", 180, false],
  ["icons/icon-maskable-192.png", 192, true],
  ["icons/icon-maskable-512.png", 512, true],
] as const)
  test(`visible source-colored prompt survives export: ${path}`, () => {
    const image = pixels(path);
    const span = maskable ? Math.round(size * 0.7) : size;
    const inset = maskable ? Math.floor((size - span) / 2) : 0;
    const point = (x: number, y: number) =>
      image.at(inset + (x * span) / 32, inset + (y * span) / 32);
    const near = (actual: number[], expected: number[]) =>
      actual.forEach((value, i) =>
        expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(8),
      );
    // Both arms and the vertex: a green dot or a dark tile cannot satisfy this.
    for (const [x, y] of [
      [9, 11],
      [13, 16],
      [9, 21],
    ])
      near(point(x!, y!), [74, 222, 128, 255]);
    near(point(20, 22), [56, 189, 248, 255]);
    near(point(20, 10), [9, 13, 22, 255]);
  });

test("notification badge retains both prompt strokes, not a tile or empty alpha", () => {
  const image = pixels("icons/badge-96.png");
  for (const [x, y] of [
    [9, 11],
    [13, 16],
    [9, 21],
    [20, 22],
  ]) {
    const rgba = image.at(x! * 3, y! * 3);
    expect(rgba.slice(0, 3)).toEqual([255, 255, 255]);
    expect(rgba[3]).toBeGreaterThan(240);
  }
  expect(image.at(60, 30)[3]).toBe(0);
  expect(image.at(3, 3)[3]).toBe(0);
  // No dark tile perimeter may survive as a white notification outline.
  for (let i = 0; i < 96; i++) {
    for (const [x, y] of [
      [i, 0],
      [i, 1],
      [0, i],
      [1, i],
      [95, i],
      [i, 95],
    ])
      expect(image.at(x!, y!)[3]).toBe(0);
  }
});

test("selected SVG is the exact historical asset, not upstream artwork", () => {
  const svg = readFileSync(resolve(root, "public/favicon.svg"));
  expect(createHash("sha256").update(svg).digest("hex")).toBe(
    "278964f3bb129696cc5138c7802bb5ea2d333b1c8320adf809a68f4058fd895f",
  );
});

test("manifest rebrands without changing installed identity or scope", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  expect([manifest.name, manifest.short_name]).toEqual([
    "Herdr Web",
    "Herdr Web",
  ]);
  expect([manifest.id, manifest.start_url, manifest.scope]).toEqual([
    "/",
    "/",
    "/",
  ]);
  expect(manifest.icons).toHaveLength(4);
  for (const icon of manifest.icons) expect(icon.src).toEndWith("?v=mahiro2");
  expect(read("index.html")).toContain("/manifest.webmanifest?v=mahiro2");
  expect(read("index.html")).toContain("<title>Herdr Web</title>");
});

test("real shell and both notification owners consume the new icon version", () => {
  for (const path of [
    "src/App.tsx",
    "src/components/AccessGate.tsx",
    "src/lib/notifications.ts",
    "public/sw.js",
  ]) {
    expect(read(path)).toContain("/icons/icon-192.png?v=mahiro2");
    expect(read(path)).not.toContain("?v=ram1");
  }
  expect(read("public/sw.js")).toContain("/icons/badge-96.png?v=mahiro2");
  expect(read("public/sw.js")).toContain(
    'const CACHE_NAME = "herdr-web-ui-v6-mahiro"',
  );
  expect(read("src/App.tsx")).toContain('const APP_TITLE = "Herdr Web"');
  expect(read("src/App.tsx")).toContain(
    'Herdr <span className="brand-sub">Web</span>',
  );
});

test("exported PNG dimensions and notification alpha match their roles", () => {
  for (const [path, size] of [
    ["icons/icon-192.png", 192],
    ["icons/icon-512.png", 512],
    ["icons/icon-maskable-512.png", 512],
    ["icons/badge-96.png", 96],
    ["apple-touch-icon.png", 180],
    ["favicon.png", 64],
  ] as const) {
    const png = readFileSync(resolve(root, "public", path));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
  }
  const badge = readFileSync(resolve(root, "public/icons/badge-96.png"));
  expect([4, 6]).toContain(badge[25]); // PNG grayscale/RGB with alpha, never an opaque tile.
});
