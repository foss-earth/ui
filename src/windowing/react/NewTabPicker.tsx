import { ChoiceTrack } from "../../shell/reactControls.js";
import { TAB_PICKER_CHOICES, TAB_PICKER_ID } from "../../settings/uiParameters.js";

interface NewTabPickerProps<TabId extends string> {
  availableTabs: readonly TabId[];
  getLabel: (tabId: TabId) => string;
  onOpenTab: (tabId: TabId) => void;
  allTabsOpenText?: string;
  onTabPickerChange?: (mode: "tab" | "dropdown") => void;
}

/** The picker is ordinary window content: natural-width buttons wrap like words. */
export function NewTabPicker<TabId extends string>({
  availableTabs, getLabel, onOpenTab, allTabsOpenText, onTabPickerChange,
}: NewTabPickerProps<TabId>) {
  return (
    <div className="foss-earth-new-tab" data-tab-picker="tab">
      <div className="foss-earth-new-tab-grid" role="group" aria-label="Available tabs">
        {availableTabs.length === 0 ? (
          <span>{allTabsOpenText ?? "All tabs open"}</span>
        ) : availableTabs.map(tabId => (
          <button
            key={tabId}
            type="button"
            className="foss-earth-new-tab-choice"
            data-tab-id={tabId}
            onClick={() => onOpenTab(tabId)}
          >
            {getLabel(tabId)}
          </button>
        ))}
      </div>
      {onTabPickerChange ? (
        <ChoiceTrack
          heading="Tab picker"
          choices={TAB_PICKER_CHOICES}
          value="tab"
          parameter={TAB_PICKER_ID}
          defaultValue="tab"
          help="Dropdown makes + open a menu instead of this tab. The menu's last item, Use New tab, comes back here."
          onChange={mode => { if (mode === "tab" || mode === "dropdown") onTabPickerChange(mode); }}
        />
      ) : null}
    </div>
  );
}
