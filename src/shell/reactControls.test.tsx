// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSettingsRegistry } from "../settings/registry.js";
import type { ParameterSpec } from "../settings/types.js";
import { ChoiceTrack, HelpTip, IconButton, ParameterSettings, Resettable } from "./reactControls.js";

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

const resettable: ParameterSpec[] = [
  { id: "t.volume", label: "Volume", description: "A level.", unit: "count", kind: "number", bounds: () => ({ min: 0, max: 8 }), step: 0.05, default: 2,
    appliesLive: true, source: "src/test.ts", defaultReason: "Chosen for tests.", home: { tab: "sound", section: "levels", level: "main" } },
  { id: "t.view", label: "View", description: "A choice.", unit: "none", kind: "choice", choices: [{ id: "first", label: "Cockpit" }, { id: "third", label: "Chase" }], default: "third",
    appliesLive: true, source: "src/test.ts", defaultReason: "Chosen for tests.", home: { tab: "sound", section: "levels", level: "main" } },
];

function registry() {
  const data = new Map<string, string>();
  const settings = createSettingsRegistry({ storage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } } });
  settings.register(resettable);
  return settings;
}

it("puts a reset on a hand-drawn widget of a registry parameter, in a span around it, that follows the registry", () => {
  const settings = registry();
  act(() => root.render(<ParameterSettings.Provider value={settings}>
    <label><span>Master volume</span><Resettable parameter="t.volume" name="Master volume"><input type="range" aria-label="Master volume" /></Resettable></label>
  </ParameterSettings.Provider>));
  const range = host.querySelector("input")!;
  const anchor = range.parentElement!;
  expect(anchor.className).toBe("foss-earth-parameter__widget foss-earth-parameter__reset-anchor");
  const badge = anchor.querySelector<HTMLButtonElement>(".foss-earth-parameter__reset")!;
  expect(badge.hidden).toBe(true);
  act(() => { settings.set("t.volume", 3); });
  expect(badge.hidden).toBe(false);
  expect(badge.getAttribute("aria-label")).toBe("Reset Master volume to the default: 2");
  act(() => badge.click());
  expect(settings.get("t.volume")).toBe(2);
  expect(badge.hidden).toBe(true);
});

it("draws no reset for a parameter without a registry, and one for a value the host keeps, from its props", () => {
  const resets: number[] = [];
  function Wind() {
    const [speed, setSpeed] = useState(0);
    return <>
      <Resettable parameter="t.volume"><input type="range" aria-label="Volume" /></Resettable>
      <Resettable changed={speed !== 0} label={`Reset Wind speed to the default: 0 kt`} onReset={() => { resets.push(speed); setSpeed(0); }}>
        <input type="range" aria-label="Wind speed" value={speed} onChange={event => setSpeed(Number(event.target.value))} />
      </Resettable>
      <button type="button" onClick={() => setSpeed(12)}>Gust</button>
    </>;
  }
  act(() => root.render(<Wind />));
  const badges = () => [...host.querySelectorAll<HTMLButtonElement>(".foss-earth-parameter__reset")];
  expect(badges()).toHaveLength(1);
  expect(badges()[0].hidden).toBe(true);
  act(() => host.querySelector<HTMLButtonElement>("button[type=button]:not(.foss-earth-parameter__reset)")!.click());
  expect(badges()[0].hidden).toBe(false);
  expect(badges()[0].title).toBe("Reset Wind speed to the default: 0 kt");
  act(() => badges()[0].click());
  expect(resets).toEqual([12]);
  expect(host.querySelector<HTMLInputElement>('[aria-label="Wind speed"]')!.value).toBe("0");
  expect(badges()[0].hidden).toBe(true);
});

it("puts a ChoiceTrack's reset on its segments, against the registry or a default the host gives", () => {
  const settings = registry();
  function Tracks() {
    const [mode, setMode] = useState("on");
    return <ParameterSettings.Provider value={settings}>
      <ChoiceTrack heading="View" parameter="t.view" value={String(settings.get("t.view"))} onChange={id => settings.set("t.view", id)}
        choices={[{ id: "first", label: "Cockpit" }, { id: "third", label: "Chase" }]} />
      <ChoiceTrack heading="Spin" defaultValue="off" value={mode} onChange={setMode}
        choices={[{ id: "off", label: "Off" }, { id: "on", label: "On" }]} />
    </ParameterSettings.Provider>;
  }
  act(() => root.render(<Tracks />));
  const [view, spin] = [...host.querySelectorAll<HTMLElement>(".foss-earth-parameter__pills")];
  const badge = (pills: HTMLElement) => pills.querySelector<HTMLButtonElement>(":scope > .foss-earth-parameter__reset")!;
  expect(badge(view).hidden).toBe(true);
  act(() => { settings.set("t.view", "first"); });
  expect(badge(view).hidden).toBe(false);
  expect(badge(view).title).toBe("Reset View to the default: Chase");
  act(() => badge(view).click());
  expect(settings.get("t.view")).toBe("third");
  expect(badge(spin).hidden).toBe(false);
  expect(badge(spin).title).toBe("Reset Spin to the default: Off");
  act(() => badge(spin).click());
  expect(spin.querySelector<HTMLInputElement>("input[value=off]")!.checked).toBe(true);
  expect(badge(spin).hidden).toBe(true);
});
