/** Optional explicit browser clipboard adapter; reads only the supplied document/view when invoked. */
export function createBrowserClipboard(document: Document, navigator: Pick<Navigator, "clipboard">): (text: string) => Promise<void> {
  return copyText;
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch { /* Local HTTP pages may still allow copying a selection. */ }
  }
  const focused = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    if (!document.execCommand?.("copy")) throw new Error("Clipboard unavailable");
  } finally {
    field.remove();
    if (focused && "focus" in focused && typeof focused.focus === "function") focused.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }
}

}
