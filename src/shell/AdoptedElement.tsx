import { useLayoutEffect, useRef } from "react";

/**
 * Moves a node the host already built and wired into this spot, and lets it go
 * again when the tab closes. Its listeners and state travel with it, so closing
 * and reopening the tab loses nothing.
 */
export function AdoptedElement({ element, className }: { element: HTMLElement; className?: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const parent = element.parentElement;
    const next = element.nextSibling;
    host.append(element);
    return () => {
      // Back where the host kept it, so a log can float again when its tab closes.
      if (parent?.isConnected) parent.insertBefore(element, next);
      else element.remove();
    };
  }, [element]);
  return <div ref={hostRef} className={className} />;
}
