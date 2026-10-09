# UI owner instructions

You cannot have AI as a co-author, or your contributions will be rejected.

This repository owns shared settings mechanisms, generic window state, widgets
and contribution presentation lifecycle. Feature catalogues, concrete panels,
host application construction and feature diagnostics remain with their owners.
Inject the host's one SettingsRegistry; do not create an application singleton.
Core entry points must load without React, DOM globals or renderer creation.
Browser adapters are optional exports. Preserve parameter IDs, record versions,
workspace IDs and migration callbacks supplied by consumers.

Scratch and retained check logs belong in build/. Never delete prior evidence.
Use the coordinator's exclusive heavy-check window, cap workers at 50%, and
run the documented checks once per finished candidate. No implicit server,
benchmark, GPU run or native/WASM build.

This is a private staging extraction, not history or publication acceptance.
The coordinator owns extracted lineage and remote admission. Shared CI caller,
policy and consumer-conformance pins must be installed before publication;
metadata checks must include documentation-only changes.
