# Browser tests

jsdom lays nothing out and draws no scrollbar, so `npm run test:browser` checks what depends on
those in real browsers: `tests/browser/*.browser.test.ts`, with Vitest in Node driving headless
Chrome over CDP and Firefox over WebDriver BiDi through the `browser-testing` checkout beside
this one. It reaches that checkout by a relative path rather than a `file:` dependency, so
`npm install` and `npm test` still work from a plain checkout. Screenshots and the built test
page go to `build/`.

Each test file builds its page with Vite's `build()` and loads it from a file. Vitest runs in
the mode "test", which compiles JSX for React's development build, so the page rendered nothing
until the build said `mode: "production"` and `oxc: { jsx: { development: false } }`.

## Three ways to see a page

The tab strip's tests run each check in Chrome as a phone, Chrome as a desktop and Firefox with
overlay scrollbars.

- **A phone.** `Emulation.setDeviceMetricsOverride` with `mobile: true` draws Android's overlay
  scrollbars and matches `(pointer: coarse)` and `(hover: none)`, and
  `Emulation.setTouchEmulationEnabled` takes touches. The page needs the app's
  `<meta name="viewport" content="width=device-width, initial-scale=1.0">`. Without it a phone
  lays the page out 980 px wide and zooms out, and touches land away from where
  `getBoundingClientRect()` puts things.
- **A desktop.** Headless Chrome on a Mac draws overlay scrollbars only while something
  scrolls, so a screenshot that should show one is taken just after a scroll gesture.
- **Firefox.** `ui.useOverlayScrollbars: 1` draws overlay scrollbars everywhere, as on a Mac,
  Windows 11 and Android, `layout.testing.overlay-scrollbars.always-visible: true` keeps them
  showing, and `general.smoothScroll: false` scrolls in one step. A wheel action returns
  before the page has scrolled, so a test polls `scrollLeft` until it changes and stops
  changing.

## Where a tap goes

A phone does not send a tap to the element under its point. Chrome's touch adjustment sends
it to the nearest element that takes taps, and prefers a small one. A tap on the bottom edge
of a tab went to a scrollbar 1 px below it while `elementFromPoint()` named the tab. So taps
in these tests land on the edges of what they press, and a test that fails here should check
which element got `pointerdown`. Something drawn next to a tap target, like the tab strip's
scrollbar, takes no touches (`pointer-events: none` under `(pointer: coarse)`).

## Checking what is drawn

To check that nothing is drawn over something, a test compares a screenshot of it with one
taken after hiding what should not be there, such as a scrollbar with `scrollbar-width: none`
and `::-webkit-scrollbar { display: none }`. The page decodes both PNGs with
`createImageBitmap` and `OffscreenCanvas` and counts the pixels that differ. Geometry checks
are steadier where they are enough: a scrolling element that ends inside its clipped parent
shows its scrollbars whole.
