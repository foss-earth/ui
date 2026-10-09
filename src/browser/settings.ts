import {
  createSettingsRegistry,
  type SettingsRegistry,
  type SettingsRegistryOptions,
} from "../settings/registry.js";
import { readBrowserStorage } from "./storage.js";

/**
 * Compatibility adapter for the old omitted-storage browser default. Hosts
 * still register their catalogue, aliases, migrations and presets explicitly.
 */
export function createBrowserSettingsRegistry(options: SettingsRegistryOptions = {}): SettingsRegistry {
  const storage = options.storage === undefined ? readBrowserStorage() : options.storage;
  const settings = createSettingsRegistry({ ...options, storage });
  if (storage !== null || options.storage !== undefined) return settings;
  return {
    ...settings,
    getStorageError: () => settings.getStorageError()
      ?? "Browser storage is unavailable, so settings last only until the page reloads.",
  };
}
