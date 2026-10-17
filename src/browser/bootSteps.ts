/** An app's side of the boot terminal (bootTerminal.ts): each call does nothing on a page without it. */
import { BOOT_TERMINAL_GLOBAL, type BootLog, type FossEarthBoot } from "./bootTerminal.js";

export type { BootLog, BootLogEntry, BootLogLine, BootTone, FossEarthBoot } from "./bootTerminal.js";

const terminal = (): FossEarthBoot | undefined => (globalThis as unknown as Record<string, FossEarthBoot | undefined>)[BOOT_TERMINAL_GLOBAL];

/** Says what the start does now; `fraction` is how far the start is past the download, from 0 to 1. */
export function bootStep(id: string, text: string, fraction?: number): void {
  terminal()?.step(id, text, fraction);
}

/** Prints the terminal's lines into the app's log, which carries the record on; the app then calls `finishBoot`. */
export function attachBootLog(log: BootLog): void {
  terminal()?.attach(log);
}

/** The 3D scene's first frame is on screen. */
export function finishBoot(): void {
  terminal()?.done();
}

/** The app is ready: a page that attached no log, so draws no scene, hands over now. */
export function bootReady(): void {
  terminal()?.ready();
}

/** The start failed, for this reason. */
export function failBoot(text: string): void {
  terminal()?.fail(text);
}
