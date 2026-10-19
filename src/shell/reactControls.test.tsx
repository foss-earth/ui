// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChoiceTrack, HelpTip, IconButton } from "./reactControls.js";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("draws `View [Cockpit / Chase] ?` with the shared track, follows its value and keeps unavailable choices visible", () => {
  const seen: string[] = [];
  function View() {
    const [value, setValue] = useState("first");
    return <ChoiceTrack heading="View" value={value} onChange={id => { seen.push(id); setValue(id); }} help={<b>Cockpit or chase.</b>}
      choices={[{ id: "first", label: "Cockpit" }, { id: "third", label: "Chase" }, { id: "free", label: "Free camera", shortLabel: "Free", unavailable: "Not built yet" }]} />;
  }
  act(() => root.render(<View />));
  const group = host.querySelector<HTMLElement>("[role=radiogroup]")!;
  expect(group.getAttribute("aria-label")).toBe("View");
  expect([...group.children].map(child => child.className)).toEqual(["foss-earth-choices__heading", "foss-earth-parameter__pills", "foss-earth-help-tooltip"]);
  const radios = [...group.querySelectorAll<HTMLInputElement>("input[type=radio]")];
  expect(radios.map(radio => radio.checked)).toEqual([true, false, false]);
  expect(radios[2].disabled).toBe(true);
  expect(radios[2].closest("label")!.title).toBe("Not built yet");
  expect(radios[2].getAttribute("aria-label")).toBe("Free camera");
  expect(group.querySelector(".foss-earth-parameter__help")!.textContent).toBe("Cockpit or chase.");
  act(() => radios[1].click());
  expect(seen).toEqual(["third"]);
  expect(radios.map(radio => radio.checked)).toEqual([false, true, false]);
  // The same element stays: an open ? or focus survives a value change.
  expect(host.querySelector("[role=radiogroup]")).toBe(group);
});

it("snaps back when the host refuses a choice", () => {
  act(() => root.render(<ChoiceTrack heading="Mode" value="a" onChange={() => {}} choices={[{ id: "a", label: "A" }, { id: "b", label: "B" }]} />));
  const [a, b] = host.querySelectorAll<HTMLInputElement>("input[type=radio]");
  act(() => b.click());
  expect(a.checked).toBe(true);
  expect(b.checked).toBe(false);
});

it("draws an icon action with its full name, and a ? with React content", () => {
  const clicked = vi.fn();
  act(() => root.render(<><IconButton icon="copy" label="Copy performance trace" onClick={clicked} /><HelpTip label="Explain the trace"><code>window.trace</code></HelpTip></>));
  const button = host.querySelector<HTMLButtonElement>("[data-icon=copy]")!;
  expect(button.getAttribute("aria-label")).toBe("Copy performance trace");
  expect(button.title).toBe("Copy performance trace");
  expect(button.querySelector("svg.foss-earth-action-icon")).not.toBeNull();
  act(() => button.click());
  expect(clicked).toHaveBeenCalledOnce();
  const help = host.querySelector<HTMLButtonElement>("[aria-label='Explain the trace']")!;
  expect(help).not.toBeNull();
  expect(host.querySelector(".foss-earth-parameter__help code")!.textContent).toBe("window.trace");
});
