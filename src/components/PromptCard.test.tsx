import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { InteractivePrompt } from "../../shared/protocol.ts";
import { SettingsProvider } from "../lib/settings.ts";
import { PromptCard } from "./PromptCard.tsx";

const prompt: InteractivePrompt = {
  id: "question", agent: "pi", kind: "question", title: "", question: "Which do you prefer?", body: null,
  options: [{ label: "Tea", description: null }, { label: "Coffee", description: null }],
  multi_select: false, custom_option_index: null,
};

function render(value: InteractivePrompt): string {
  const saved = Object.getOwnPropertyDescriptor(navigator, "languages");
  Object.defineProperty(navigator, "languages", { configurable: true, value: ["en"] });
  try {
    return renderToStaticMarkup(createElement(SettingsProvider, {
      children: createElement(PromptCard, { paneId: "fixture", prompt: value, onPromptChanged: () => {}, onAnswered: () => {} }),
    }));
  } finally {
    if (saved) Object.defineProperty(navigator, "languages", saved);
    else Reflect.deleteProperty(navigator, "languages");
  }
}

test("titleless questions use the question as the foldable heading without duplicating it", () => {
  const html = render(prompt);
  expect(html).toContain('class="prompt-card is-question-header"');
  expect(html).toContain("<h2>Which do you prefer?</h2>");
  expect(html.match(/Which do you prefer\?/g)?.length).toBe(1);
});

test("titled prompts retain a separate title and question", () => {
  const html = render({ ...prompt, title: "Choose a drink" });
  expect(html).toContain("<h2>Choose a drink</h2>");
  expect(html).toContain('class="prompt-card-question">Which do you prefer?</p>');
  expect(html).not.toContain("is-question-header");
});
