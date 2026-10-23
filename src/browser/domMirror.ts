/**
 * A picture of the page's own interface, to draw where the page is not seen:
 * a cockpit's screen, or a panel in a headset. The page keeps laying the
 * interface out and running it. A snapshot copies what it shows, with the
 * page's style sheets, into an SVG image, HTML inside a foreignObject, which a
 * canvas draws without being tainted because it comes from a data: address (a
 * blob: one taints it). The page's own canvases, such as an instrument drawn
 * on the GPU, are drawn over the snapshot as they are at each draw, so they
 * move at the drawing's rate and not the snapshot's. A WebGPU canvas, or a
 * WebGL one that does not keep its drawing buffer, holds its picture only in
 * the task that drew it: its renderer calls `noteCanvasDrawn` after each
 * picture, and the mirror draws from a copy of the last.
 *
 * A snapshot of the flight's interface costs about 5 ms of the main thread on
 * an M5 MacBook Air in Chrome 155 (2026-10-21), most of it the image's own
 * style and layout, and once its style sheets are cached about 1 ms more to
 * copy. Take one only when the page changed, and at a bounded rate. A style
 * sheet's url() resources are not fetched: an SVG image loads nothing of its
 * own, and the interface uses none today.
 */

export interface MirrorRect { x: number; y: number; width: number; height: number }

/** The event `noteCanvasDrawn` sends: its name is the contract, for a renderer that does not import this module. */
export const CANVAS_DRAWN_EVENT = "foss-earth:canvas-drawn";

/**
 * A canvas whose picture lasts only the task that drew it, a WebGPU one or a
 * WebGL one without `preserveDrawingBuffer`, has a new picture: a mirror
 * copies it now, while it can. Call it after each picture's commands are
 * submitted. Without a mirror it costs one event with no listener.
 */
export function noteCanvasDrawn(canvas: HTMLCanvasElement): void {
  canvas.dispatchEvent(new Event(CANVAS_DRAWN_EVENT, { bubbles: true }));
}

export interface DomMirrorOptions {
  document: Document;
  /** False leaves an element out, with everything in it. Elements without a box, scripts and styles are always left out. */
  include?(element: Element): boolean;
  /** Whether a canvas is drawn. By default every canvas but one nearly as large as the page both ways, its 3D view. */
  drawCanvas?(canvas: HTMLCanvasElement): boolean;
  /** The page changed after a snapshot, or a snapshot became ready: a view that renders on demand draws again. */
  onChange?(): void;
  /**
   * Elements drawn without their own background, as the root and body always
   * are: those behind the page's 3D view, which the copy leaves out, so the
   * copy shows over whatever it is drawn on.
   */
  seeThrough?: string;
  /**
   * Parts of the page copied apart from the rest, each a selector of its
   * outermost elements: `draw`'s layer 1 is the first, and layer 0 the rest of
   * the page without them. A view that shows parts of the page apart, as a
   * headset's panels do, then shows none of one over another where the page
   * has them overlap.
   */
  layers?: readonly string[];
}

export interface DomMirror {
  /** Something shown may have changed since the last snapshot. */
  readonly stale: boolean;
  /** Increases each time a snapshot is ready to draw; 0 before the first. */
  readonly revision: number;
  /** The viewport the last snapshot was laid out in, in CSS px. */
  readonly viewport: { width: number; height: number };
  /** How many of the page's canvases are drawn over the last snapshot: with any, a draw can differ from the last without a new snapshot. */
  readonly canvasCount: number;
  /** Takes a snapshot if the page changed since the last; true once a new one can be drawn. One runs at a time. */
  snapshot(): Promise<boolean>;
  /**
   * Draws the page's `source` area, in CSS px of the viewport, into `target`
   * of `context`: the last snapshot, then the page's canvases as they are now.
   * `layer` is one of `DomMirrorOptions.layers`, from 1, or 0 for the rest.
   */
  draw(context: CanvasRenderingContext2D, source: MirrorRect, target: MirrorRect, layer?: number): void;
  /** Marks the page changed, for a change no observer sees. */
  invalidate(): void;
  dispose(): void;
}

/** The copy's root, standing in for the page's own: the page's `:root` and `html` rules apply to it. */
export const MIRROR_ROOT_CLASS = "foss-mirror-root";

const SKIPPED = new Set(["script", "style", "link", "template", "noscript", "iframe", "object", "embed", "video", "audio", "source", "track"]);

/** A canvas in the copy: where it was laid out, and its corner radius. */
/** A box with its corners' radius. */
export interface MirrorBox { rect: MirrorRect; radius: number }

/** A canvas drawn over the snapshot, with the boxes the page draws over it, where the snapshot is drawn again. */
export interface MirroredCanvas extends MirrorBox { canvas: HTMLCanvasElement; covers: MirrorBox[] }

/** The markup of a snapshot and the canvases drawn over it. */
export interface MirrorMarkup { svg: string; width: number; height: number; canvases: MirroredCanvas[] }

/** What a snapshot copies of the page's style sheets: rules naming only classes the page has used. */
export interface MirrorStyles {
  text(): string;
  /** Classes seen on the page since the styles were last read; a new one reads them again. */
  noteClasses(element: Element): void;
  dispose(): void;
}

/** The copy of an image, once it has loaded: a data: address an SVG image can show. */
type ImageCopies = Map<string, string | null>;

/**
 * The page's style sheets as one text, for the copy. A rule whose selectors
 * all name a class the page has never used is left out; most of the shared
 * style sheets are for tabs that are closed. `:root` and `html` become the
 * copy's root.
 */
export function createMirrorStyles(document: Document): MirrorStyles {
  const known = new Set<string>();
  const requirements = new WeakMap<CSSStyleRule, string[][]>();
  let cached: string | null = null;
  let sheets: StyleSheet[] = [];
  const note = (element: Element): void => {
    for (const name of Array.from(element.classList)) {
      if (known.has(name)) continue;
      known.add(name);
      cached = null;
    }
  };
  for (const element of Array.from(document.getElementsByTagName("*"))) note(element);
  const keeps = (rule: CSSStyleRule): boolean => {
    let needs = requirements.get(rule);
    if (!needs) { needs = selectorClasses(rule.selectorText); requirements.set(rule, needs); }
    return needs.some(names => names.every(name => known.has(name)));
  };
  const walk = (rules: CSSRuleList, into: string[]): void => {
    for (const rule of Array.from(rules)) {
      const style = rule as CSSStyleRule;
      if (typeof style.selectorText === "string") {
        // Nested rules are kept whole, as written.
        if (style.cssRules?.length) { into.push(rootRewritten(rule.cssText)); continue; }
        if (keeps(style)) into.push(`${rootSelector(style.selectorText)} { ${style.style.cssText} }`);
        continue;
      }
      const imported = (rule as CSSImportRule).styleSheet;
      if (imported !== undefined) {
        if (imported) { try { walk(imported.cssRules, into); } catch { /* Another origin's sheet cannot be read. */ } }
        continue;
      }
      // @media, @supports, @container and @layer keep the rules in them the page uses; @keyframes is kept whole.
      const group = (rule as CSSGroupingRule).cssRules;
      if (group && !/^@(-\w+-)?keyframes/.test(rule.cssText)) {
        const inner: string[] = [];
        walk(group, inner);
        if (inner.length) into.push(`${rule.cssText.slice(0, rule.cssText.indexOf("{"))}{\n${inner.join("\n")}\n}`);
        continue;
      }
      into.push(rule.cssText);
    }
  };
  return {
    text() {
      const current = Array.from(document.styleSheets);
      if (current.length !== sheets.length || current.some((sheet, index) => sheet !== sheets[index])) { sheets = current; cached = null; }
      if (cached !== null) return cached;
      const parts: string[] = [];
      for (const sheet of current) {
        try { walk(sheet.cssRules, parts); } catch { /* Another origin's sheet cannot be read. */ }
      }
      cached = parts.join("\n");
      return cached;
    },
    noteClasses: note,
    dispose() { known.clear(); cached = null; sheets = []; },
  };
}

/** For each selector in a list, the classes it needs; a selector inside :not(), :is(), :where() or :has() needs none of its own. */
export function selectorClasses(selectorText: string): string[][] {
  return splitTopLevel(selectorText).map(selector => {
    let plain = "";
    let depth = 0;
    for (const character of selector) {
      if (character === "(") depth++;
      else if (character === ")") depth = Math.max(0, depth - 1);
      else if (depth === 0) plain += character;
    }
    // Attribute values may hold dots: [href="a.b"].
    plain = plain.replace(/\[[^\]]*\]/g, "");
    return [...plain.matchAll(/\.(-?[_a-zA-Z\u00a0-\uffff][\w\u00a0-\uffff-]*)/g)].map(match => match[1]!);
  });
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") depth--;
    else if (character === "," && depth === 0) { parts.push(text.slice(start, index)); start = index + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

const rootSelector = (selector: string): string =>
  selector.replace(/:root\b/g, `.${MIRROR_ROOT_CLASS}`).replace(/(^|[\s>+~,(])html(?![\w-])/g, `$1.${MIRROR_ROOT_CLASS}`);
const rootRewritten = (css: string): string => css.replace(/:root\b/g, `.${MIRROR_ROOT_CLASS}`);

const escapeAttribute = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Whether an element is drawn at all: it has a box, or is `display: contents` and its children may. */
function shown(element: Element): boolean {
  const check = (element as Element & { checkVisibility?: (options?: object) => boolean }).checkVisibility;
  if (!check || check.call(element)) return true;
  return element.ownerDocument.defaultView?.getComputedStyle(element).display === "contents";
}

/**
 * Whether an element is in the top layer, drawn over the page where it lays
 * it out whatever holds it: an open popover or modal dialog. A browser
 * without one of them throws on its selector.
 */
function inTopLayer(element: Element): boolean {
  if (!element.hasAttribute("popover") && element.localName !== "dialog") return false;
  return [":popover-open", "dialog:modal"].some(selector => { try { return element.matches(selector); } catch { return false; } });
}

/**
 * The page as markup for an SVG image of the viewport: the body's shown
 * elements with their form state and scroll, the documentElement's classes,
 * attributes and style on the copy's root, and the style sheets. What is in
 * the top layer goes last, at its box, as nothing in the copy is open: its
 * own popover would hide it.
 */
export function mirrorMarkup(document: Document, options: Omit<DomMirrorOptions, "document">, styles: string, images: ImageCopies = new Map()): MirrorMarkup {
  const view = document.defaultView!;
  const width = view.innerWidth, height = view.innerHeight;
  const canvases: MirroredCanvas[] = [];
  // Boxes with a background after a canvas in the page: drawn over it, as a menu over an instrument.
  const covers: (MirrorBox & { after: number })[] = [];
  const noteCover = (element: Element): void => {
    const style = view.getComputedStyle(element);
    const painted = backgroundAlpha(style.backgroundColor) >= 0.5
      || Boolean(style.backgroundImage && style.backgroundImage !== "none")
      || Boolean(style.backdropFilter && style.backdropFilter !== "none");
    if (!painted) return;
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) {
      covers.push({ rect: { x: box.left, y: box.top, width: box.width, height: box.height }, radius: parseFloat(style.borderTopLeftRadius) || 0, after: canvases.length });
    }
  };
  const drawCanvas = options.drawCanvas ?? ((canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    return !(rect.width >= width * 0.9 && rect.height >= height * 0.9);
  });
  const topLayer: { element: Element; copied: Element }[] = [];
  const copy = (node: Node): Node | null => {
    if (node.nodeType === 3) return node.cloneNode(false);
    if (node.nodeType !== 1) return null;
    const element = node as Element;
    if (SKIPPED.has(element.localName) || !shown(element) || options.include?.(element) === false) return null;
    if (element.localName === "canvas") return canvasStandIn(element as HTMLCanvasElement);
    if (canvases.length > 0) noteCover(element);
    // An icon's gradients and clip paths have no box of their own: it is copied whole.
    if (element.namespaceURI === "http://www.w3.org/2000/svg") return element.cloneNode(true);
    const result = element.cloneNode(false) as Element;
    formState(element, result, images);
    const lifted = inTopLayer(element);
    if (lifted) {
      const box = element.getBoundingClientRect();
      const computed = view.getComputedStyle(element);
      result.removeAttribute("popover");
      // What it inherits is its holder's, which the end of the body is not.
      result.setAttribute("style", `${element.getAttribute("style") ?? ""};position:fixed;inset:auto;left:${box.left + view.scrollX}px;top:${box.top + view.scrollY}px;`
        + `width:${box.width}px;height:${box.height}px;margin:0;transform:none;box-sizing:border-box;z-index:2147483647;color:${computed.color};font:${computed.font}`);
      // Over what opened it: the later in the page, the later opened, mostly.
      topLayer.push({ element, copied: result });
    }
    let into: Element = result;
    if (element.scrollTop || element.scrollLeft) {
      // The copy is laid out unscrolled: its content moves by the page's scroll instead.
      into = document.createElement("div");
      into.setAttribute("style", `transform:translate(${-element.scrollLeft}px,${-element.scrollTop}px)`);
      result.appendChild(into);
    }
    // A text box's text is its value, set above.
    const children = element.localName === "textarea" ? [] : Array.from(element.childNodes);
    for (const child of children) {
      const copied = copy(child);
      if (copied) into.appendChild(copied);
    }
    return lifted ? null : result;
  };
  const canvasStandIn = (canvas: HTMLCanvasElement): Element => {
    const standIn = document.createElement("div");
    for (const attribute of Array.from(canvas.attributes)) if (attribute.name !== "width" && attribute.name !== "height") standIn.setAttribute(attribute.name, attribute.value);
    const computed = view.getComputedStyle(canvas);
    const display = computed.display === "inline" ? "inline-block" : computed.display;
    standIn.setAttribute("style", `${canvas.getAttribute("style") ?? ""};display:${display};width:${canvas.offsetWidth}px;height:${canvas.offsetHeight}px;background:transparent`);
    if (drawCanvas(canvas)) {
      const box = canvas.getBoundingClientRect();
      canvases.push({ canvas, rect: { x: box.left, y: box.top, width: box.width, height: box.height }, radius: parseFloat(computed.borderTopLeftRadius) || 0, covers: [] });
    }
    return standIn;
  };
  const body = document.body ? copy(document.body) as Element | null : null;
  for (const { element, copied } of topLayer) {
    body?.appendChild(copied);
    // Over every canvas.
    if (canvases.length > 0) noteCover(element);
  }
  canvases.forEach((canvas, index) => {
    for (const { rect, radius, after } of covers) if (after > index && overlaps(rect, canvas.rect)) canvas.covers.push({ rect, radius });
  });
  const root = document.documentElement;
  const attributes = Array.from(root.attributes)
    .filter(attribute => attribute.name !== "class" && attribute.name !== "style" && attribute.name !== "xmlns")
    .map(attribute => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`).join("");
  let content = body ? new XMLSerializer().serializeToString(body) : "";
  if (view.scrollX || view.scrollY) content = `<div style="transform:translate(${-view.scrollX}px,${-view.scrollY}px)">${content}</div>`;
  const clear = [`.${MIRROR_ROOT_CLASS}`, `.${MIRROR_ROOT_CLASS} body`, ...options.seeThrough ? [`.${MIRROR_ROOT_CLASS} :is(${options.seeThrough})`] : []];
  // A style element's text is markup here: a "<" in it would end it.
  const css = `${styles}\n${clear.join(", ")} { background: none !important; }`.replace(/</g, "\\3c ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" class="${MIRROR_ROOT_CLASS} ${escapeAttribute(root.className)}"${attributes}`
    + ` style="${escapeAttribute(root.getAttribute("style") ?? "")};width:${width}px;height:${height}px;position:relative;overflow:hidden">`
    + `<style>${css}</style>${content}</div></foreignObject></svg>`;
  return { svg, width, height, canvases };
}

/**
 * What each picture of a snapshot copies: the page without its layers, then
 * each layer with the elements holding it.
 */
export function layerFilters(document: Document, layers: readonly string[]): ((element: Element) => boolean)[] {
  if (layers.length === 0) return [() => true];
  const all = layers.join(", ");
  return [
    element => !element.matches(all),
    ...layers.map(selector => {
      const holders = new Set<Element>();
      for (const part of Array.from(document.querySelectorAll(selector))) {
        for (let holder = part.parentElement; holder && !holders.has(holder); holder = holder.parentElement) holders.add(holder);
      }
      // A part's own elements are reached only through it.
      return (element: Element): boolean => holders.has(element) || element.matches(selector) || element.parentElement?.closest(selector) != null;
    }),
  ];
}

const overlaps = (a: MirrorRect, b: MirrorRect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A computed colour's alpha, 0 to 1: `rgba(r, g, b, a)`, or the part after the slash of the other forms. */
function backgroundAlpha(color: string): number {
  if (!color || color === "transparent") return 0;
  const open = color.indexOf("("), close = color.lastIndexOf(")");
  if (open < 0 || close < open) return 1;
  const inner = color.slice(open + 1, close);
  const slash = inner.lastIndexOf("/");
  const parts = inner.split(",");
  const alpha = slash >= 0 ? inner.slice(slash + 1) : parts.length === 4 ? parts[3]! : null;
  if (alpha === null) return 1;
  const value = parseFloat(alpha);
  return Number.isFinite(value) ? alpha.trim().endsWith("%") ? value / 100 : value : 1;
}

/** What the page's form controls hold, which their attributes do not say. */
function formState(element: Element, copy: Element, images: ImageCopies): void {
  switch (element.localName) {
    case "input": {
      const input = element as HTMLInputElement;
      if (input.type === "checkbox" || input.type === "radio") {
        if (input.checked) copy.setAttribute("checked", ""); else copy.removeAttribute("checked");
      } else if (input.type !== "file" && input.type !== "password") copy.setAttribute("value", input.value);
      break;
    }
    case "textarea": copy.textContent = (element as HTMLTextAreaElement).value; break;
    case "option":
      if ((element as HTMLOptionElement).selected) copy.setAttribute("selected", ""); else copy.removeAttribute("selected");
      break;
    case "img": {
      const image = element as HTMLImageElement;
      const source = image.currentSrc || image.src;
      if (!source || source.startsWith("data:")) break;
      copy.removeAttribute("srcset");
      const copied = images.get(source);
      if (copied) copy.setAttribute("src", copied);
      else {
        copy.removeAttribute("src");
        if (copied === undefined && image.complete && image.naturalWidth > 0) images.set(source, imageData(image));
      }
      break;
    }
  }
}

/** A loaded image as a data: address, or null for one this page cannot read, such as another origin's. */
function imageData(image: HTMLImageElement): string | null {
  try {
    const canvas = image.ownerDocument.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    return canvas.toDataURL("image/webp", 0.9);
  } catch { return null; }
}

/** How many sizes of a snapshot are kept drawn, for a mirror drawn at more than one. */
const DRAWN_SIZES = 4;

export function createDomMirror(options: DomMirrorOptions): DomMirror {
  const { document } = options;
  const view = document.defaultView!;
  const styles = createMirrorStyles(document);
  const images: ImageCopies = new Map();
  let stale = true;
  let revision = 0;
  // A picture of each layer: the rest of the page first.
  let current: { image: HTMLImageElement; markup: MirrorMarkup }[] | null = null;
  let running: Promise<boolean> | null = null;
  let disposed = false;
  // Drawing an SVG image rasterises it again each time: each size is drawn once a snapshot.
  const drawn = new Map<string, { canvas: HTMLCanvasElement; revision: number }>();
  // The last picture of each canvas that says when it drew, which it does not keep itself.
  const held = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
  const hold = (event: Event): void => {
    const canvas = event.target;
    if (!(canvas instanceof view.HTMLCanvasElement) || canvas.width === 0 || canvas.height === 0) return;
    let copy = held.get(canvas);
    if (!copy) {
      copy = document.createElement("canvas");
      held.set(canvas, copy);
    }
    if (copy.width !== canvas.width || copy.height !== canvas.height) {
      copy.width = canvas.width;
      copy.height = canvas.height;
    }
    const context = copy.getContext("2d");
    if (!context) return;
    context.globalCompositeOperation = "copy";
    try { context.drawImage(canvas, 0, 0); } catch { /* A canvas whose context was lost keeps its last copy. */ }
  };

  const changed = (): void => {
    if (stale) return;
    stale = true;
    options.onChange?.();
  };
  const observer = new view.MutationObserver(records => {
    changed();
    for (const record of records) {
      if (record.type === "attributes" && record.attributeName === "class") styles.noteClasses(record.target as Element);
      else if (record.type === "childList") {
        for (const node of Array.from(record.addedNodes)) {
          if (node.nodeType !== 1) continue;
          styles.noteClasses(node as Element);
          for (const inner of Array.from((node as Element).getElementsByTagName("*"))) styles.noteClasses(inner);
        }
      }
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  // A control's value and a scroll change nothing an observer sees.
  for (const type of ["input", "change", "scroll"]) document.addEventListener(type, changed, { capture: true, passive: true });
  view.addEventListener("resize", changed);
  document.addEventListener(CANVAS_DRAWN_EVENT, hold, { capture: true, passive: true });

  const take = async (): Promise<boolean> => {
    stale = false;
    const knownImages = images.size;
    const text = styles.text();
    const markups = layerFilters(document, options.layers ?? []).map(include =>
      mirrorMarkup(document, { ...options, include: element => options.include?.(element) !== false && include(element) }, text, images));
    // An image copied during this snapshot shows in the next.
    if (images.size !== knownImages) changed();
    const pictures = markups.map(markup => {
      const image = new view.Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup.svg)}`;
      return { image, markup };
    });
    try { await Promise.all(pictures.map(picture => picture.image.decode())); } catch { return false; }
    if (disposed) return false;
    current = pictures;
    revision++;
    options.onChange?.();
    return true;
  };

  const rasterised = (source: MirrorRect, target: MirrorRect, layer: number): HTMLCanvasElement | null => {
    const picture = current?.[layer];
    if (!picture) return null;
    const width = Math.max(1, Math.round(target.width)), height = Math.max(1, Math.round(target.height));
    const key = `${layer}:${source.x},${source.y},${source.width},${source.height}:${width}x${height}`;
    let entry = drawn.get(key);
    if (!entry) {
      if (drawn.size >= DRAWN_SIZES) drawn.delete(drawn.keys().next().value!);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      entry = { canvas, revision: -1 };
      drawn.set(key, entry);
    }
    if (entry.revision !== revision) {
      const context = entry.canvas.getContext("2d")!;
      context.clearRect(0, 0, width, height);
      context.drawImage(picture.image, source.x, source.y, source.width, source.height, 0, 0, width, height);
      entry.revision = revision;
    }
    return entry.canvas;
  };

  return {
    get stale() { return stale; },
    get revision() { return revision; },
    get canvasCount() { return current?.reduce((count, { markup }) => count + markup.canvases.length, 0) ?? 0; },
    get viewport() { return current ? { width: current[0]!.markup.width, height: current[0]!.markup.height } : { width: view.innerWidth, height: view.innerHeight }; },
    snapshot() {
      if (disposed) return Promise.resolve(false);
      if (running) return running;
      if (!stale && current) return Promise.resolve(false);
      running = take().finally(() => { running = null; });
      return running;
    },
    draw(context, source, target, layer = 0) {
      const picture = rasterised(source, target, layer);
      if (!picture || !current) return;
      context.drawImage(picture, target.x, target.y, target.width, target.height);
      const scaleX = target.width / source.width, scaleY = target.height / source.height;
      for (const { canvas, rect, radius, covers } of current[layer]!.markup.canvases) {
        if (!canvas.isConnected || canvas.width === 0 || canvas.height === 0) continue;
        if (rect.x >= source.x + source.width || rect.y >= source.y + source.height || rect.x + rect.width <= source.x || rect.y + rect.height <= source.y) continue;
        const x = target.x + (rect.x - source.x) * scaleX, y = target.y + (rect.y - source.y) * scaleY;
        const width = rect.width * scaleX, height = rect.height * scaleY;
        context.save();
        context.beginPath();
        context.rect(target.x, target.y, target.width, target.height);
        context.clip();
        // The canvas's own box: the snapshot is drawn again over it only.
        context.beginPath();
        context.roundRect(x, y, width, height, radius * Math.min(scaleX, scaleY));
        context.clip();
        try { context.drawImage(held.get(canvas) ?? canvas, x, y, width, height); } catch { /* A canvas whose context was lost draws nothing. */ }
        if (covers.length > 0) {
          // What the page draws over the canvas: the snapshot again, only where it covers it.
          context.beginPath();
          for (const cover of covers) {
            const r = cover.rect;
            context.roundRect(target.x + (r.x - source.x) * scaleX, target.y + (r.y - source.y) * scaleY, r.width * scaleX, r.height * scaleY, cover.radius * Math.min(scaleX, scaleY));
          }
          context.clip();
          context.drawImage(picture, target.x, target.y, target.width, target.height);
        }
        context.restore();
      }
    },
    invalidate: changed,
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      for (const type of ["input", "change", "scroll"]) document.removeEventListener(type, changed, { capture: true });
      view.removeEventListener("resize", changed);
      document.removeEventListener(CANVAS_DRAWN_EVENT, hold, { capture: true });
      styles.dispose();
      drawn.clear();
      images.clear();
      current = null;
    },
  };
}
