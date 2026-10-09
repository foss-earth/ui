import type { ParameterSectionOptions } from "../../src/shell/settings/parameterSection.js";
/** The test host owns one clock shared by its sections; production widgets own none. */
export function testReadingRefresh(): ParameterSectionOptions["refresh"] & { dispose(): void } {
  const listeners = new Set<() => void>();
  let timer: number | undefined;
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (timer === undefined) timer = window.setInterval(() => { for (const update of listeners) update(); }, 1000);
      let stopped = false;
      return () => {
        if (stopped) return; stopped = true; listeners.delete(listener);
        if (listeners.size === 0) { window.clearInterval(timer); timer = undefined; }
      };
    },
    dispose() { listeners.clear(); window.clearInterval(timer); timer = undefined; },
  };
}
