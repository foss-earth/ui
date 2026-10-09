# Host DOM contracts

Current source preparation is UNRUN. The frozen ee3d085 UI archive retains its prior contract; a new archive and actual host qualification are required before adoption.

The host provides `ParameterSectionOptions.document` and the one shared `refresh.subscribe` port. Sections, main controls, Show all parameters, paired numeric fields, presets, source links, tracks and explanation content use that Document. `createSectionsElement` and `appendHostSections` likewise require `document` in their options. They start no private refresh clock.

Standalone `createParameterControl`, `createParameterList`, `createSettingsTransfer`, `createPresetStatus`, `createSavePresetControl`, `createPresetsSection`, `createThemeControl`, `createSavedSettingsSection` and `createSettingsView` take a final Document argument. `createChoiceGroup`, `createChoiceNote` and `createExternalLinkIcon` do likewise. TrackOptions and TwoPositionSliderOptions require `document`. `createAppFilesSection` takes Document after its shared refresh argument.

Dials use their supplied centre element's ownerDocument. Help controls use their supplied content element's ownerDocument and its live defaultView. Each Document has its own open-help state; opening help in another document does not close this document's explanation. These controls require a live host view, rather than a detached HTML document with no view. Parameter DOM checks use the supplied node's structure, and invalid-edit events are created by its ownerDocument. Clipboard access in settings transfer comes from that document's view; unavailable or synchronously failing access offers the existing select-text fallback. Omitted presentation storage likewise comes from that Document's view, with unavailable storage falling back to memory only.

Original single-document assertion bodies are retained with fixtures that pass their own Document explicitly. Six new causal cases exercise actual controls with ambient globals removed, independent explanation state across two supplied documents, missing-Document rejection before refresh acquisition, supplied-origin storage, and absent/synchronously failing Clipboard APIs. No check or cross-browser/native qualification has run for these cases. Other browser/React subsystems still require their documented independent host ports and are not qualified by these cases.

The original application and public routes remain live. Their temporary compatibility facade must bind its existing application Document explicitly when it adopts this source; no old caller is retired now. Earth alone integrates that facade. Flight and Campus own their corresponding composition. Source/API mismatch, actual installed runtime/declaration/CSS consumers, shared attribution and final public source/archive pins remain release blockers.

`readDeviceContext` is exported from `@foss-earth/ui/browser` and requires
`{ navigator, window }` reports supplied by the host; each may be null when
unavailable. Its original pixel ratio, core, reported memory and touch defaults
are retained. The old application facade must bind its own browser objects.
This adapter makes no hardware probe, renderer or feature-default decision.
Three causal cases and the public consumer fixtures are prepared but UNRUN.
