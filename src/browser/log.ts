import { createBrowserClipboard } from "./clipboard.js";
import type { GameLogPorts } from "../log/createGameLog.js";

/** Explicit optional browser timer/clipboard/viewport adapter. Host keeps placement authority. */
export function browserGameLogPorts(element: HTMLElement, view: Window, host: Pick<GameLogPorts, "onSize" | "isCentered">): GameLogPorts {
  return {
    element,
    ...host,
    copy: createBrowserClipboard(element.ownerDocument, view.navigator),
    viewportHeight: () => view.innerHeight,
    timers: { set: (work, ms) => view.setTimeout(work, ms), clear: timer => view.clearTimeout(timer as number | undefined) },
  };
}
