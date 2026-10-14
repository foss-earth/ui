import type { WindowTabIcon } from "../windowing/core/types.js";

/**
 * The mark before a tab's label. An image is a frame holding a sun over a
 * hill; a sphere is a ball with the near halves of its equator and a
 * meridian, so it reads as round rather than as the globe's wireframe. Drawn
 * in the text colour, so it follows the theme.
 */
export function TabIcon({ icon }: { icon: WindowTabIcon }) {
  return <svg className="foss-earth-tab-icon" data-icon={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {icon === "image" ? <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.75" />
      <path d="m6 20 9-9 6 6" />
    </> : <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12a9 4 0 0 0 18 0" />
      <path d="M12 3a4 9 0 0 0 0 18" />
    </>}
  </svg>;
}
