// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * From 11 to 26 October 2026, FOSS Earth's own pages showed the UMN tour's
 * palette. Their <html> named it, and the log's number fields drew UMN's
 * maroon and gold with no palette named at all. A palette is named on the
 * page's root, and its colors apply only there. A number field's face draws
 * its digits, so the field hides its own text in every palette.
 */

const ROOT = path.join(import.meta.dirname, "..");
const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");
const stylesheets = ["src", "assets"].flatMap(directory =>
  readdirSync(path.join(ROOT, directory), { recursive: true, encoding: "utf8" })
    .filter(file => file.endsWith(".css"))
    .map(file => path.join(directory, file)));

/** UMN's maroons and golds, as hex or rgb. */
const UMN_COLOR = /#7a0019|#5b0013|#900021|#ffcc33|#ffde7a|#e6b325|rgba?\(\s*122,\s*0,\s*25\b|rgba?\(\s*255,\s*204,\s*51\b|rgba?\(\s*230,\s*179,\s*37\b/i;

/** Each stylesheet's innermost rules, so those inside @media count too. */
function rules(css: string): Array<{ selector: string; body: string }> {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@(?:import|charset)[^;]*;/g, "");
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim().replace(/\s+/g, " "), body }));
}

/** A selector list's selectors: commas inside :is(), :not() or [] do not split it. */
function selectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let at = 0; at < list.length; at++) {
    if (list[at] === "(" || list[at] === "[") depth++;
    else if (list[at] === ")" || list[at] === "]") depth--;
    else if (list[at] === "," && depth === 0) { parts.push(list.slice(start, at).trim()); start = at + 1; }
  }
  return [...parts, list.slice(start).trim()];
}

/** The selector without its :not() parts, which name what it excludes. */
function withoutNot(selector: string): string {
  let out = "";
  for (let at = 0; at < selector.length;) {
    if (!selector.startsWith(":not(", at)) { out += selector[at++]; continue; }
    let depth = 0;
    do { if (selector[at] === "(") depth++; else if (selector[at] === ")") depth--; at++; } while (depth > 0 && at < selector.length);
  }
  return out;
}

describe("UMN's colors", () => {
  it("are drawn only where a page names the UMN palette", () => {
    expect(stylesheets).toEqual(expect.arrayContaining([path.join("src", "styles", "ui.css"), path.join("assets", "theme.css")]));
    const unscoped = stylesheets.flatMap(file => rules(read(file))
      .filter(({ body }) => UMN_COLOR.test(body))
      .flatMap(({ selector }) => selectors(selector).filter(one => !withoutNot(one).includes('[data-ui-theme="umn"]')).map(one => `${file}: ${one}`)));
    expect(unscoped).toEqual([]);
  });
});

describe("number fields in each palette", () => {
  const MAROON = "rgb(122, 0, 25)", GOLD = "rgb(230, 179, 37)";
  const MAROON_FILL = "rgba(122, 0, 25, 0.35)", GOLD_FILL = "rgba(255, 204, 51, 0.45)";

  beforeAll(() => {
    // The order a host loads them in: the palettes after the shared styles.
    for (const css of [read("src/styles/ui.css").replace(/@import[^;]*;/g, ""), read("assets/theme.css")]) {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
    }
  });

  /** The log's number field and another section's, as controls.ts builds them, in a page with this palette and mode. */
  function fields(palette: "earth" | "umn", mode: "dark" | "light"): { log: HTMLInputElement; other: HTMLInputElement } {
    const root = document.documentElement;
    if (palette === "earth") root.removeAttribute("data-ui-theme");
    else root.setAttribute("data-ui-theme", palette);
    root.setAttribute("data-theme", mode);
    // Replacing the body also clears jsdom's computed styles, which an attribute change keeps.
    document.body.innerHTML = ["interface/log", "renderer/frame"].map(section => `
      <section data-settings-section="${section}">
        <span class="foss-earth-parameter__number">
          <input type="text" class="foss-earth-parameter__field" value="40"><span class="foss-earth-parameter__face" aria-hidden="true">0040</span>
        </span>
      </section>`).join("");
    const [log, other] = document.querySelectorAll<HTMLInputElement>(".foss-earth-parameter__field");
    return { log, other };
  }
  const TRANSPARENT = "rgba(0, 0, 0, 0)";
  // jsdom keeps an outline shorthand whole, so only an outline-color is compared.
  const look = (field: HTMLElement) => {
    const style = getComputedStyle(field);
    return { border: style.borderTopColor, background: style.backgroundColor };
  };

  for (const mode of ["dark", "light"] as const) {
    it(`gives the log's numbers Earth's own field colors without a palette, ${mode}`, () => {
      const { log, other } = fields("earth", mode);
      expect(look(log)).toEqual(look(other));
      const style = getComputedStyle(log);
      expect([style.borderTopColor, style.backgroundColor, style.outline, style.outlineColor].join(" ")).not.toMatch(UMN_COLOR);
    });
  }

  it("draws the log's numbers dark maroon in the UMN palette's dark mode", () => {
    expect(look(fields("umn", "dark").log)).toEqual({ border: MAROON, background: MAROON_FILL });
  });

  it("draws them yellow in its light mode, the palette and mode both being on the root", () => {
    const { log } = fields("umn", "light");
    expect({ ...look(log), outline: getComputedStyle(log).outlineColor }).toEqual({ border: GOLD, background: GOLD_FILL, outline: GOLD });
  });

  for (const palette of ["earth", "umn"] as const) {
    for (const mode of ["dark", "light"] as const) {
      it(`hides a number field's own text under its face until it is typed in, ${palette} ${mode}`, () => {
        const shown = fields(palette, mode);
        expect(getComputedStyle(shown.log).color).toBe(TRANSPARENT);
        expect(getComputedStyle(shown.other).color).toBe(TRANSPARENT);
        // A new body, as jsdom keeps an element's computed style when focus moves.
        const typed = fields(palette, mode);
        typed.other.focus();
        expect(typed.other.matches(":focus")).toBe(true);
        expect(getComputedStyle(typed.other).color).not.toBe(TRANSPARENT);
      });
    }
  }
});
