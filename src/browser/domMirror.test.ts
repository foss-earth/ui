// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { CANVAS_DRAWN_EVENT, MIRROR_ROOT_CLASS, createDomMirror, createMirrorStyles, layerFilters, mirrorMarkup, noteCanvasDrawn, selectorClasses } from "./domMirror.js";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("class");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
});

function style(css: string): void {
  const element = document.createElement("style");
  element.textContent = css;
  document.head.appendChild(element);
}

/** The copy's markup, parsed back. */
function parsed(svg: string): Document {
  return new DOMParser().parseFromString(svg, "image/svg+xml");
}

describe("the classes a selector needs", () => {
  it("are those outside functional pseudo-classes and attribute values, for each selector in a list", () => {
    expect(selectorClasses(".a .b > .c, .d")).toEqual([["a", "b", "c"], ["d"]]);
    expect(selectorClasses(".a:not(.b):is(.c, .d)")).toEqual([["a"]]);
    expect(selectorClasses('[href="x.y"] .z, :root')).toEqual([["z"], []]);
    expect(selectorClasses(".flight-hud__value--warn::after")).toEqual([["flight-hud__value--warn"]]);
  });
});

describe("the copy's style sheets", () => {
  it("keep the rules whose classes the page has used, make :root and html the copy's root, and grow as classes appear", () => {
    style(`:root { --tint: red; } html[data-theme="dark"] body { color: white; } .used { color: blue; } .unused { color: green; }
      .used, .never { margin: 1px; } @media (min-width: 1px) { .used { padding: 2px; } .unused { padding: 3px; } }`);
    document.body.innerHTML = `<div class="used"></div>`;
    const styles = createMirrorStyles(document);
    const text = styles.text();
    expect(text).toContain(`.${MIRROR_ROOT_CLASS} {`);
    expect(text).toContain(`.${MIRROR_ROOT_CLASS}[data-theme="dark"] body`);
    expect(text).toContain(".used {");
    expect(text).toContain(".used, .never");
    expect(text).toContain("padding: 2px");
    expect(text).not.toContain(".unused");
    expect(styles.text()).toBe(text);

    const later = document.createElement("span");
    later.className = "unused";
    styles.noteClasses(later);
    expect(styles.text()).toContain(".unused { color: green; }");
    expect(styles.text()).toContain("padding: 3px");
  });

  it("are read again when a style sheet is added", () => {
    document.body.innerHTML = `<div class="a"></div>`;
    const styles = createMirrorStyles(document);
    expect(styles.text()).toBe("");
    style(".a { color: red; }");
    expect(styles.text()).toContain(".a { color: red; }");
  });
});

describe("the copy of the page", () => {
  it("is the body's shown elements in an SVG image the size of the viewport, on a see-through root that carries the page's own", () => {
    document.documentElement.className = "theme-dark";
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("style", "--ui-scale: 1.2");
    document.body.innerHTML = `<main class="ui"><p>Hello &amp; <b>welcome</b></p><script>alert(1)</script><aside class="skip">x</aside></main>`;
    const markup = mirrorMarkup(document, { include: element => !element.classList.contains("skip"), seeThrough: ".app, .view" }, ".ui { color: red; } a<b");
    expect(markup.width).toBe(window.innerWidth);
    expect(markup.height).toBe(window.innerHeight);
    const copy = parsed(markup.svg);
    expect(copy.querySelector("parsererror")).toBeNull();
    const root = copy.querySelector("foreignObject > div")!;
    expect(root.getAttribute("class")).toBe(`${MIRROR_ROOT_CLASS} theme-dark`);
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.getAttribute("style")).toContain("--ui-scale: 1.2");
    expect(root.querySelector("style")!.textContent).toBe(".ui { color: red; } a\\3c b\n"
      + `.${MIRROR_ROOT_CLASS}, .${MIRROR_ROOT_CLASS} body, .${MIRROR_ROOT_CLASS} :is(.app, .view) { background: none !important; }`);
    expect(root.querySelector("main p")!.textContent).toBe("Hello & welcome");
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector(".skip")).toBeNull();
  });

  it("leaves its layers out of the rest, and copies each with what holds it but nothing beside it", () => {
    document.body.innerHTML = `<main class="app"><section class="window"><p>Sky</p></section><div class="hud"><b>IAS</b><i>296</i></div></main><footer>bar</footer>`;
    const [rest, hud] = layerFilters(document, [".hud"]).map(include => parsed(mirrorMarkup(document, { include }, "").svg));
    expect(rest!.querySelector(".window p")!.textContent).toBe("Sky");
    expect(rest!.querySelector("footer")).not.toBeNull();
    expect(rest!.querySelector(".hud")).toBeNull();
    expect(hud!.querySelector("main.app > .hud")!.textContent).toBe("IAS296");
    expect(hud!.querySelector(".window")).toBeNull();
    expect(hud!.querySelector("footer")).toBeNull();
    expect(layerFilters(document, [])).toHaveLength(1);
  });

  it("holds the form controls' current state and the page's scroll", () => {
    document.body.innerHTML = `<input class="range" type="range" value="1"><input type="checkbox"><input type="password" value="secret">
      <textarea>old</textarea><select><option>a</option><option>b</option></select><div class="list"><span>row</span></div>`;
    const [range, checkbox, password] = Array.from(document.querySelectorAll("input"));
    range!.value = "7";
    checkbox!.checked = true;
    password!.value = "typed";
    document.querySelector("textarea")!.value = "new";
    document.querySelector("select")!.selectedIndex = 1;
    const list = document.querySelector(".list") as HTMLElement;
    Object.defineProperty(list, "scrollTop", { value: 40 });
    const copy = parsed(mirrorMarkup(document, {}, "").svg);
    const inputs = copy.querySelectorAll("input");
    expect(inputs[0]!.getAttribute("value")).toBe("7");
    expect(inputs[1]!.hasAttribute("checked")).toBe(true);
    expect(inputs[2]!.getAttribute("value")).toBe("secret");
    expect(copy.querySelector("textarea")!.textContent).toBe("new");
    expect(Array.from(copy.querySelectorAll("option")).map(option => option.hasAttribute("selected"))).toEqual([false, true]);
    expect(copy.querySelector(".list > div")!.getAttribute("style")).toBe("transform:translate(0px,-40px)");
  });

  it("lifts what is in the top layer to the end, at its box, shown although nothing in the copy is open", () => {
    document.body.innerHTML = `<div class="window"><div class="tip" popover="manual" style="color: red">Help</div><p>after</p></div>`;
    const tip = document.querySelector(".tip")!;
    tip.matches = (selector: string) => selector === ":popover-open" || Element.prototype.matches.call(tip, selector);
    tip.getBoundingClientRect = () => ({ left: 30, top: 40, width: 200, height: 50, x: 30, y: 40, right: 230, bottom: 90, toJSON() {} });
    const body = parsed(mirrorMarkup(document, {}, "").svg).querySelector("body")!;
    expect(body.querySelector(".window .tip")).toBeNull();
    expect(body.querySelector(".window p")).not.toBeNull();
    const lifted = body.lastElementChild!;
    expect(lifted.getAttribute("class")).toBe("tip");
    expect(lifted.hasAttribute("popover")).toBe(false);
    expect(lifted.getAttribute("style")).toMatch(/^color: red;position:fixed;inset:auto;left:30px;top:40px;width:200px;height:50px;/);
    expect(lifted.textContent).toBe("Help");
  });

  it("stands a box in for each canvas, to be drawn over it, but not for the page's 3D view", () => {
    document.body.innerHTML = `<canvas class="view"></canvas><canvas class="gauge" style="border-top-left-radius: 4px"></canvas>`;
    const [view, gauge] = Array.from(document.querySelectorAll("canvas"));
    const box = (element: Element, width: number, height: number) => {
      Object.defineProperty(element, "offsetWidth", { value: width });
      Object.defineProperty(element, "offsetHeight", { value: height });
      element.getBoundingClientRect = () => ({ left: 10, top: 20, width, height, x: 10, y: 20, right: 10 + width, bottom: 20 + height, toJSON() {} });
    };
    box(view!, window.innerWidth, window.innerHeight);
    box(gauge!, 60, 30);
    const markup = mirrorMarkup(document, {}, "");
    expect(markup.canvases).toEqual([{ canvas: gauge, rect: { x: 10, y: 20, width: 60, height: 30 }, radius: 4, covers: [] }]);
    const standIns = parsed(markup.svg).querySelectorAll("body > div");
    expect(standIns).toHaveLength(2);
    expect(standIns[1]!.getAttribute("class")).toBe("gauge");
    expect(standIns[1]!.getAttribute("style")).toContain("width:60px;height:30px");
  });

  it("notes what the page draws over a canvas after it: a box with a background", () => {
    document.body.innerHTML = `<div class="hud"><canvas></canvas><span class="label"></span></div>
      <div class="menu" style="background-color: rgb(8, 14, 20); border-top-left-radius: 6px"></div>
      <div class="glass" style="background-color: rgba(8, 14, 20, 0.2)"></div><div class="away" style="background-color: red"></div>`;
    const place = (selector: string, left: number, top: number, width: number, height: number) => {
      const element = document.querySelector(selector)!;
      Object.defineProperty(element, "offsetWidth", { value: width });
      Object.defineProperty(element, "offsetHeight", { value: height });
      element.getBoundingClientRect = () => ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON() {} });
    };
    place("canvas", 0, 0, 100, 100);
    place(".label", 10, 10, 20, 10);
    place(".menu", 50, 50, 200, 200);
    place(".glass", 0, 0, 100, 100);
    place(".away", 300, 300, 10, 10);
    const [canvas] = mirrorMarkup(document, {}, "").canvases;
    expect(canvas!.covers).toEqual([{ rect: { x: 50, y: 50, width: 200, height: 200 }, radius: 6 }]);
  });
});

describe("a mirror", () => {
  it("is stale until a snapshot, and again when the page changes", async () => {
    document.body.innerHTML = `<p>one</p>`;
    const mirror = createDomMirror({ document });
    expect(mirror.stale).toBe(true);
    expect(mirror.revision).toBe(0);
    // jsdom does not decode images: the snapshot fails, but the page counts as seen.
    await mirror.snapshot();
    expect(mirror.stale).toBe(false);
    document.querySelector("p")!.textContent = "two";
    await Promise.resolve();
    expect(mirror.stale).toBe(true);
    mirror.dispose();
  });
});

describe("a canvas that says it drew", () => {
  it("tells the document, where a mirror copies it", () => {
    document.body.innerHTML = `<div><canvas></canvas></div>`;
    const canvas = document.querySelector("canvas")!;
    const heard: EventTarget[] = [];
    const listener = (event: Event) => heard.push(event.target!);
    document.addEventListener(CANVAS_DRAWN_EVENT, listener, { capture: true });
    noteCanvasDrawn(canvas);
    document.removeEventListener(CANVAS_DRAWN_EVENT, listener, { capture: true });
    expect(heard).toEqual([canvas]);
  });
});
