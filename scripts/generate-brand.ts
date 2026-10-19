/** Export the selected legacy SVG without redrawing its geometry. Requires ImageMagick. */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = new URL("..", import.meta.url).pathname;
const source = join(root, "public/favicon.svg");
// Pinned to 387ea2f:public/favicon.svg without requiring historical Git objects
// in a shallow checkout. The accepted source itself ships with the application.
const accepted = readFileSync(source);
if (
  createHash("sha256").update(accepted).digest("hex") !==
  "278964f3bb129696cc5138c7802bb5ea2d333b1c8320adf809a68f4058fd895f"
)
  throw new Error("Brand source differs from the selected legacy SVG");
console.log(
  `Source SHA-256: ${createHash("sha256").update(accepted).digest("hex")}`,
);
mkdirSync(join(root, "public/icons"), { recursive: true });
const magick = process.env["MAGICK_BIN"] || "/opt/homebrew/bin/magick";
function exportImage(path: string, size: number, extra: string[] = []): void {
  execFileSync(
    magick,
    [
      "-background",
      "none",
      "-density",
      "3072",
      "svg:-",
      "-resize",
      `${size}x${size}`,
      ...extra,
      "-strip",
      "-depth",
      "8",
      ...(path.endsWith(".png") ? ["-define", "png:color-type=6"] : []),
      join(root, path),
    ],
    {
      // MSVG incorrectly inherits stroke-opacity:0 from its initial stroke:none.
      // Make SVG's standard initial value explicit, without changing any artwork.
      input: accepted
        .toString()
        .replace(/stroke="[^"]+"/g, '$& stroke-opacity="1"'),
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  console.log(path);
}
for (const size of [192, 512]) {
  exportImage(`public/icons/icon-${size}.png`, size);
  // Keep the complete existing mark within Android's maskable safe circle.
  exportImage(
    `public/icons/icon-maskable-${size}.png`,
    Math.round(size * 0.7),
    [
      "-background",
      "#090d16",
      "-gravity",
      "center",
      "-extent",
      `${size}x${size}`,
    ],
  );
}
// Android uses alpha alone: remove only the dark tile, leaving the original prompt strokes.
exportImage("public/icons/badge-96.png", 96, [
  "-channel",
  "A",
  "-fx",
  "a*max(0,min(1,(max(g,b)-r-0.1)/0.3))",
  "+channel",
  "-channel",
  "RGB",
  "-evaluate",
  "set",
  "100%",
  "+channel",
]);
exportImage("public/apple-touch-icon.png", 180);
exportImage("public/favicon.png", 64);
exportImage("public/favicon.ico", 32);
// Marketing/social artwork is intentionally retained as pinned upstream reference.
