export type PublishedVersion =
  /** The page carries no stamp: there is nothing to compare. */
  | { kind: "unstamped" }
  | { kind: "off"; build: string }
  | { kind: "not-asked"; build: string }
  | { kind: "unanswered"; build: string; why: string; at: number }
  /** This page is the published one. */
  | { kind: "published"; build: string; at: number }
  /** This page is older than the published one, built `published`. */
  | { kind: "older"; build: string; published: string; at: number }
  /** The site answered with an older page than this one, as a host may for a while after a release. */
  | { kind: "ahead"; build: string; published: string; at: number };

/** "just now", "40 s ago", "12 min ago", "3 h ago". */
function ago(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 90) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

/** What Settings → App files and the diagnostics report say of `state`. */
export function describePublishedVersion(state: PublishedVersion, now: number): string {
  switch (state.kind) {
    case "unstamped": return "This page does not say which build it is, so the app cannot tell whether it is the published one: a development build, or an app whose host supplies no build stamp.";
    case "off": return `This page was built ${state.build}. The site is not asked which version is published: that is turned off.`;
    case "not-asked": return `This page was built ${state.build}. The site has not been asked yet which version is published.`;
    case "unanswered": return `This page was built ${state.build}. The site could not be asked which version is published, ${ago(now - state.at)}: ${state.why}.`;
    case "published": return `This page is the published version of the app, built ${state.build}; the site was asked ${ago(now - state.at)}.`;
    case "older": return `This page is an older version of the app, built ${state.build}: the published one was built ${state.published}; the site was asked ${ago(now - state.at)}.`;
    case "ahead": return `This page was built ${state.build}, after the page the site answered with ${ago(now - state.at)}, built ${state.published}: a host can take a while to publish a release everywhere.`;
  }
}

