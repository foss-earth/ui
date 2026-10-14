// The page tabStripScrollbar.browser.test.ts loads: the real DockPanel and
// TabStrip with the real windowing.css, at a phone's panel width.
// ?tabs= sets how many tabs are open.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DockPanel } from "../../src/windowing/react/DockPanel.js";
import { TabStrip } from "../../src/windowing/react/TabStrip.js";

const LABELS = ["Map", "Scenes", "Location", "Weather", "Sky", "Camera", "Log", "Settings", "Diagnostics", "Images", "Sound", "About"];
const count = Number(new URLSearchParams(location.search).get("tabs") ?? LABELS.length);

declare global {
  interface Window { tabs: { open: string[]; active: string | null } }
}

function Fixture() {
  const [open, setOpen] = useState(() => LABELS.slice(0, count));
  const [active, setActive] = useState<string | null>(LABELS[0]);
  window.tabs = { open, active };
  return (
    <DockPanel
      side="left"
      width={340}
      maxWidth={340}
      onWidthChange={() => {}}
      collapsed={false}
      onCollapsedChange={() => {}}
      header={(
        <TabStrip
          openTabs={open}
          activeTab={active}
          availableTabs={LABELS.filter((label) => !open.includes(label))}
          addMenuOpen={false}
          onSelectTab={setActive}
          onCloseTab={(id) => setOpen((tabs) => tabs.filter((tab) => tab !== id))}
          onOpenTab={() => {}}
          onAddMenuOpenChange={() => {}}
          getLabel={(id) => id}
        />
      )}
    >
      <p>Body</p>
    </DockPanel>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
