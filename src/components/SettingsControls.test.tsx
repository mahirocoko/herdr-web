import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Stepper } from "./SettingsControls.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
afterEach(() => { for (const tree of mounted.splice(0)) act(() => tree.unmount()); });

function mount(value: number) {
  const changes: number[] = [];
  const props = { label: "Fixture size", value, text: `${value}px`, min: 10, max: 22, decreaseLabel: "Smaller", increaseLabel: "Larger", onChange: (next: number) => changes.push(next) };
  let tree!: ReactTestRenderer;
  act(() => { tree = create(createElement(Stepper, props)); });
  mounted.push(tree);
  const button = (label: string) => tree.root.findAllByType("button").find((item) => item.props["aria-label"] === label)!;
  return { changes, button, update: (next: number) => act(() => tree.update(createElement(Stepper, { ...props, value: next, text: `${next}px` }))) };
}

test("the min/max button stays focusable, announces its limit and never changes the value", () => {
  const { changes, button, update } = mount(21);
  expect(button("Larger").props["aria-disabled"]).toBeUndefined();
  act(() => button("Larger").props.onClick());
  expect(changes).toEqual([22]);
  update(22);
  expect(button("Larger").props["aria-disabled"]).toBe(true);
  expect(button("Larger").props.disabled).toBeUndefined();
  act(() => button("Larger").props.onClick());
  expect(changes).toEqual([22]);
  update(10);
  expect(button("Smaller").props["aria-disabled"]).toBe(true);
  expect(button("Smaller").props.disabled).toBeUndefined();
  expect(button("Larger").props["aria-disabled"]).toBeUndefined();
  act(() => button("Smaller").props.onClick());
  expect(changes).toEqual([22]);
});

test("in-range presses move exactly one step and endpoints become enabled again after an external update", () => {
  const { changes, button, update } = mount(22);
  update(16);
  expect(button("Larger").props["aria-disabled"]).toBeUndefined();
  expect(button("Smaller").props["aria-disabled"]).toBeUndefined();
  act(() => { button("Smaller").props.onClick(); button("Larger").props.onClick(); });
  expect(changes).toEqual([15, 17]);
});
