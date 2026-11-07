# A note set again as it is — 7 November 2026

P-128 in the performance ledger. Ui `703ebdc`; baseline ui `fb69a89`. Not an
item of the performance limits audit. It came from a CPU profile of the
0SFS flight app at a phone's viewport (sky P-127).

## What it was

`setNote(id, note)` runs `mutate`, which builds the parameter's state before
and after the change and compares them. It did this even when the note was
already the one given, so nothing could change. The work includes:

- the set of ids, a map of the states before, and the sets and lists of what
  changed;
- the state built again (`computeState`): bounds, choices, layers, notes and
  the value clamped and copied;
- the comparison (`sameState`), which turns both states' layers into JSON.

The sky's `instant()` clears the date's note on every update while the sky
is on, 60 times a second on every host. The date has a note only while it
cannot be read. In fly at a phone's viewport, with 4× CPU throttling,
`mutate` under `instant` took 3.0 ms/s of the main thread (sky P-127's
profiles).

Other notes are set again as they are, less often:

- fly's two exhaust references, each time the sky's white moves, though the
  note gives it to three significant digits;
- the sky's eight notes on what its model leaves without effect
  (`applySkyNotes`), each time a setting they read changes.

## What changed

`src/settings/registry.ts`: `setNote` returns at once when the parameter
already has that note. An empty note is no note, as before.

## Why it is exact

- `mutate` is the only place a state is built again after a change: its
  `change` runs, then the changed ids' cached states are dropped. Every
  input of a state is changed only inside `mutate` for the ids it affects:
  - saved, session and URL values;
  - forced values;
  - host defaults;
  - choices;
  - notes, URL notes and dropped notes;
  - the device context, for which every id's state is built again.

  The exceptions are ids that are not registered, which have no state:
  registration and stale values dropped from the record.
- A spec's `bounds` and `default` are functions of the device context. Every
  spec in FOSS Earth and 0SFS was read: each is a constant or depends only on
  the context.
- So the cached state is the one `computeState` would build. With the note
  unchanged, `mutate` built an equal state, so it notified no listener and
  no watcher.
- The only difference is the identity of the cached state object. Before, a
  new but equal object replaced it. Now the same object is kept.

## Proof

- **Differential harness** (`build/set-note/diff.test.ts`). The registry as
  committed (`registry.head.ts`) and the working tree run side by side.
  - 400 seeded random tours of 160 steps each:
    - notes set, set again, cleared and emptied;
    - values set, singly and several at once, valid and not;
    - values forced and released;
    - host defaults and choices;
    - device contexts;
    - resets;
    - reloads after another tab's write, and stale values dropped;
    - late registrations;
    - saved, URL and alias values and notes at the start.
  - After every step, the trace records:
    - each call's result or error;
    - every listener and watcher call.

    At random steps, it also records every parameter's state and the
    storage, so the cache is sometimes cold.
  - Both give identical traces:
    - 383,767 lines each;
    - 25,652 `setNote` calls;
    - 24,524 listener calls, 9,384 of them from notes;
    - 8,872 watcher calls.

    The A/A run is identical too.
- **`src/settings/registry.test.ts`**: a new test. A note cleared when there
  is none, or set again as it is, keeps the state object and notifies
  nothing. A changed or emptied note notifies once. A note for a parameter
  not yet registered is not kept. The test fails on HEAD.
- **Mutants** (`build/set-note/mutants.py`): 7 of 7 caught by the new test.
  The differential catches 4 of them, the others differing only in the
  state's identity. The mutants are:
  - the note not normalized;
  - `??` for `||`;
  - presence compared and not the text;
  - unregistered ids accepted;
  - always returning;
  - the comparison inverted;
  - HEAD.
- In ui, `npm run typecheck`, `eslint` on both files and `npm test` (629
  tests) pass. Fly's `npm run typecheck` passes.

## Measured

- **Node** (`build/set-note/bench.test.ts`): a registry with the sky's 45
  parameters, at a fixed date. The date's note is cleared when it has
  none, 200,000 times, and the middle of three runs is kept. One process
  per run, 9 interleaved rounds, with no listener called in any:
  - HEAD: median 465 ns per call (453–480);
  - the change: median 4.9 ns per call (4.3–5.6).

  A hot loop in Node keeps `mutate` optimized. Called once a frame in a
  page it costs much more, as the profiles below show. These are Node
  timings, not a frame rate.
- **Chrome**: fly in flight, at the phone's viewport (412 × 915 at 2.625)
  with 4× CPU throttling, by day, after sky P-127. Research's
  `profile.mjs` took 10 s in flight, 15 s after content. The builds were
  interleaved: before, after, after, before. Times are ms/s of main-thread
  CPU, and include what each function calls.

  | Run | fps | Main thread, % | Script, % | Sky `update` | `instant` | `mutate` under `instant` | `parseUtcDate` | `writeBuffer` | GC |
  | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
  | Before 1 | 53.6 | 83 | 63 | 14.5 | 3.9 | 3.3 | 0.4 | 22.0 | 7.6 |
  | After 1 | 53.5 | 87 | 66 | 13.4 | 1.0 | 0.0 | 0.8 | 22.6 | 7.4 |
  | After 2 | 56.0 | 78 | 60 | 10.8 | 1.0 | 0.0 | 0.8 | 23.2 | 5.6 |
  | Before 2 | 55.7 | 77 | 59 | 12.7 | 4.2 | 3.3 | 0.7 | 21.1 | 7.6 |

  - `mutate` under the sky's `instant`: 3.3 and 3.3 → 0 ms/s.
  - `instant`: 3.9 and 4.2 → 1.0 and 1.0 ms/s.
  - The main thread and the frame rate vary more between runs than this,
    so the change is not visible in them.
  - In the first run after the change, a note did change, and its
    `mutate` notified the settings window's listeners (1.5 ms/s). That
    work is the same in both builds.
- Not measured on a desktop. There the sky also clears the note at each
  update, but without throttling.

## Left

- What is left of `instant` is mostly parsing the same date again each
  frame (`parseUtcDate`, 0.4 to 0.8 ms/s here), in sky.
- Fly works out its exhaust note, and formats the number in it, each time
  the sky's white moves. It also gives the exhaust its settings again.
  Only the note's `mutate` is skipped now, when its text is the same.
- `mutate` still builds every changed parameter's state twice and compares
  their layers as JSON. This is for real changes only, which are rare.
