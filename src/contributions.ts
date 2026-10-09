import type { SettingsRegistry } from "./settings/registry.js";

/** The host owns one settings registry and every concrete command/observation. */
export interface UiContributionHost<Ports> {
  settings: SettingsRegistry;
  ports: Ports;
}

export interface UiContributionMount<Context, Target> {
  context: Context;
  target: Target;
}

/** A lazily created contribution can be hidden and shown before final disposal. */
export interface UiContributionInstance<Context, Target> {
  mount(options: UiContributionMount<Context, Target>): void;
  unmount(): void;
  dispose(): void;
}

export interface UiContributionDefinition<Context, Target, Ports> {
  /** Stable owner-defined contribution ID; several sections may share one tab. */
  id: string;
  tabId: string;
  sectionId?: string;
  label: string;
  /** Context rules are supplied by the feature/host, not hardcoded by UI. */
  isAvailable?: (context: Context) => boolean;
  /** Does not run at registration; receives the exact host registry and ports. */
  create(host: UiContributionHost<Ports>): UiContributionInstance<Context, Target>;
}

export interface UiContributionSnapshot {
  id: string;
  tabId: string;
  sectionId?: string;
  label: string;
  available: boolean;
  mounted: boolean;
}

export interface UiContributionRegistry<Context, Target, Ports> {
  /** Removing presentation never unregisters the host's parameters/saved values. */
  register(definition: UiContributionDefinition<Context, Target, Ports>): () => void;
  list(): UiContributionSnapshot[];
  getContext(): Context;
  /** Remounts requested contributions in the new context, hiding unavailable ones. */
  setContext(context: Context): void;
  /** Remembers a mount request across context changes; false while unavailable. */
  mount(id: string, target: Target): boolean;
  /** Clears the mount request, releasing visible UI but retaining its instance. */
  unmount(id: string): void;
  subscribe(listener: () => void): () => void;
  /** Unmounts and disposes every instance; repeated disposal is harmless. */
  dispose(): void;
}

export interface UiContributionRegistryOptions<Context, Ports> extends UiContributionHost<Ports> {
  context: Context;
}

interface Entry<Context, Target, Ports> {
  definition: UiContributionDefinition<Context, Target, Ports>;
  instance: UiContributionInstance<Context, Target> | null;
  request: { target: Target } | null;
  mounted: boolean;
}

/**
 * Pure synchronous lifecycle management. No DOM, React, feature import, timer,
 * capture or renderer is created here. Async preparation remains feature-owned.
 */
export function createUiContributionRegistry<Context, Target, Ports>(
  options: UiContributionRegistryOptions<Context, Ports>,
): UiContributionRegistry<Context, Target, Ports> {
  const host: UiContributionHost<Ports> = { settings: options.settings, ports: options.ports };
  const entries = new Map<string, Entry<Context, Target, Ports>>();
  const listeners = new Set<() => void>();
  let context = options.context;
  let disposed = false;

  const assertOpen = (): void => {
    if (disposed) throw new Error("The UI contribution registry is disposed.");
  };
  const notify = (): void => { for (const listener of [...listeners]) listener(); };
  const available = (entry: Entry<Context, Target, Ports>): boolean => entry.definition.isAvailable?.(context) ?? true;
  const requireEntry = (id: string): Entry<Context, Target, Ports> => {
    const entry = entries.get(id);
    if (!entry) throw new Error(`No UI contribution "${id}" is registered.`);
    return entry;
  };
  const unmountEntry = (entry: Entry<Context, Target, Ports>): void => {
    if (!entry.mounted) return;
    entry.mounted = false;
    entry.instance!.unmount();
  };
  const disposeEntry = (entry: Entry<Context, Target, Ports>): void => {
    try {
      unmountEntry(entry);
    } finally {
      const instance = entry.instance;
      entry.instance = null;
      instance?.dispose();
    }
  };
  const mountEntry = (entry: Entry<Context, Target, Ports>): boolean => {
    if (!entry.request || !available(entry)) return false;
    if (entry.mounted) return true;
    try {
      entry.instance ??= entry.definition.create(host);
      // Mark before calling the host so failed partial mounts are unmounted.
      entry.mounted = true;
      entry.instance.mount({ context, target: entry.request.target });
      return true;
    } catch (error) {
      entry.request = null;
      try {
        disposeEntry(entry);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "UI mount and cleanup failed.");
      }
      throw error;
    }
  };
  const runAll = (actions: (() => void)[], message: string): void => {
    const errors: unknown[] = [];
    for (const action of actions) {
      try { action(); } catch (error) { errors.push(error); }
    }
    if (errors.length > 0) throw new AggregateError(errors, message);
  };

  return {
    register(definition) {
      assertOpen();
      if (!definition.id.trim() || !definition.tabId.trim()) throw new Error("A UI contribution needs stable contribution and tab IDs.");
      if (entries.has(definition.id)) throw new Error(`UI contribution "${definition.id}" is already registered.`);
      const ownedDefinition = Object.freeze({ ...definition });
      const entry: Entry<Context, Target, Ports> = { definition: ownedDefinition, instance: null, request: null, mounted: false };
      entries.set(ownedDefinition.id, entry);
      notify();
      return () => {
        if (entries.get(ownedDefinition.id) !== entry) return;
        entries.delete(ownedDefinition.id);
        entry.request = null;
        try { disposeEntry(entry); } finally { notify(); }
      };
    },
    list: () => [...entries.values()].map(entry => ({
      id: entry.definition.id,
      tabId: entry.definition.tabId,
      ...(entry.definition.sectionId === undefined ? {} : { sectionId: entry.definition.sectionId }),
      label: entry.definition.label,
      available: available(entry),
      mounted: entry.mounted,
    })),
    getContext: () => context,
    setContext(next) {
      assertOpen();
      if (Object.is(next, context)) return;
      context = next;
      try {
        runAll([...entries.values()].map(entry => () => {
          try { unmountEntry(entry); } catch (error) {
            entry.request = null;
            try { disposeEntry(entry); } catch (cleanupError) {
              throw new AggregateError([error, cleanupError], "UI context cleanup failed.");
            }
            throw error;
          }
          mountEntry(entry);
        }), "One or more UI context transitions failed.");
      } finally { notify(); }
    },
    mount(id, target) {
      assertOpen();
      const entry = requireEntry(id);
      if (entry.request && Object.is(entry.request.target, target) && entry.mounted) return true;
      unmountEntry(entry);
      entry.request = { target };
      try { return mountEntry(entry); } finally { notify(); }
    },
    unmount(id) {
      assertOpen();
      const entry = requireEntry(id);
      entry.request = null;
      try { unmountEntry(entry); } finally { notify(); }
    },
    subscribe(listener) {
      assertOpen();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const all = [...entries.values()];
      entries.clear();
      for (const entry of all) entry.request = null;
      try {
        runAll(all.map(entry => () => disposeEntry(entry)), "One or more UI contributions failed to dispose.");
      } finally {
        try { notify(); } finally { listeners.clear(); }
      }
    },
  };
}
