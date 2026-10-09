import type { BugReportPanelOptions } from "../shell/bugReportPanel.js";

/** Optional object-URL adapter; no clock, navigation or publication authority. */
export function browserReportDownloads(urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">): NonNullable<BugReportPanelOptions["downloads"]> {
  return { create: blob => urls.createObjectURL(blob), revoke: url => urls.revokeObjectURL(url) };
}
