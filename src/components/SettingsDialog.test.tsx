import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AboutPage,
  LettaIntegrationGroup,
  PAGES,
  shownBy,
} from "./SettingsDialog.tsx";
import { MachineContext } from "../lib/machineContext.tsx";
import { SettingsProvider } from "../lib/settings.ts";
import type { ReactNode } from "react";

const render = (children: ReactNode): string => {
  const saved = Object.getOwnPropertyDescriptor(navigator, "languages");
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: ["en"],
  });
  try {
    return renderToStaticMarkup(createElement(SettingsProvider, { children }));
  } finally {
    if (saved) Object.defineProperty(navigator, "languages", saved);
    else Reflect.deleteProperty(navigator, "languages");
  }
};

Object.defineProperty(globalThis, "__APP_VERSION__", {
  value: "0.5.0-test",
  configurable: true,
});

describe("fork settings surfaces", () => {
  it("removes app install controls while retaining manifest and Push service worker owners", () => {
    for (const path of ["SettingsDialog.tsx", "MachineSidebar.tsx"]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).not.toContain("useInstallPrompt");
      expect(source).not.toContain('t("Install app")');
    }
    const manifest = JSON.parse(
      readFileSync(
        new URL("../../public/manifest.webmanifest", import.meta.url),
        "utf8",
      ),
    );
    expect(manifest.id).toBeTruthy();
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(
      readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"),
    ).toContain('"push"');
  });
  it("renders fork links and actual build version without upstream management controls", () => {
    const html = render(createElement(AboutPage, { herdrVersion: "0.9.5" }));
    expect(html).toContain("mahirocoko/herdr-web");
    expect(html).toContain("0.5.0-test");
    expect(html).toContain("0.9.5");
    expect(html).toContain("d918448647e41079c52047ffc96cdaac50ccba32");
    expect(html).not.toContain("herdrweb.dev");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Update now");
  });

  it("does not offer the hidden usage page", () => {
    expect(PAGES.some((page) => page.id === "usage")).toBe(false);
    expect(shownBy({ page: "usage", keyBar: false })).toBeNull();
    expect(shownBy({ page: "appearance", keyBar: false })).toEqual({
      page: "appearance",
      keyBar: false,
    });
  });

  it("describes private local history without an installation command or installed claim", () => {
    const html = render(createElement(LettaIntegrationGroup));
    expect(html).toContain("No global integration installation is required.");
    expect(html).toContain("Not provided by this fork.");
    expect(html).not.toContain("herdr integration install");
    expect(html).not.toContain("<button");
    const remote = render(
      createElement(
        MachineContext.Provider,
        { value: "remote" },
        createElement(LettaIntegrationGroup),
      ),
    );
    expect(remote).toContain("not remote PCs");
    expect(remote).not.toContain(
      "No global integration installation is required.",
    );
  });
});
