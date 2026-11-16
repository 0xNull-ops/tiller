# Making a scene theme

A scene theme is a palette plus artwork drawn around the normal app: a banner, framed panels, a
chat backdrop, a user avatar and the journey map. Every scene is one manifest
(`apps/web/src/fork/scenes/manifest.ts`) that one renderer and one stylesheet draw. Adding a theme is
mostly art and numbers, not code. Web and desktop only; mobile is untouched.

Follow these steps in order. Each ends with a check; do not move on until it passes.

## 1. Brief

Write five lines before generating anything:

- **Name:** original, two words (Neon Boulevard, Gilded Realm).
- **Vibe:** era, mood, time of day, three palette colors.
- **Banner story:** what sits on the left (calm, behind the logo), centre and right.
- **Map style:** what the city grid reads as (streets, fields, corridors) and its traveler (car, rider, paw, boat, sleigh, or a custom sprite) and trail.
- **Motion:** at most one flyby (an object that crosses the banner now and then). Optional.

**Originality rule.** Match a genre's feel, never a product. No game, film or brand logos, fonts that
copy a logo, named or recognisable characters, or signature objects (a franchise's emblem, creature or
landmark). Leaving the name off does not make a copy original. Swap each one for an invented equivalent.

Check: someone who knows the genre would say "that vibe", and nothing in the brief is named after a product.

## 2. Art

Generate with an image model (we use Codex image generation). Save masters as PNG plus a WebP copy
in a `<theme>/` folder kept outside the repository, with a `manifest.md` listing size and alpha.

| File            | Size            | Notes                                                                                     |
| --------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `banner`        | 2400×440        | Key content in the 30%–85% vertical band; left ~15% calm; bottom 10% fades to near-black. |
| `logo`          | ~900×300, alpha | The word "Tiller" in lettering that suits the theme. Original lettering.                  |
| `character`     | ~800×900, alpha | Optional bust, invented person, cropped at the chest.                                     |
| `chat-backdrop` | 1600×1000       | Low contrast, left half mostly dark (text sits there).                                    |
| `avatar-user`   | 256×256         | Square, readable at 42px.                                                                 |
| `corner`        | ~160×160, alpha | Optional top-left frame ornament.                                                         |
| flyby sprite    | ~400×160, alpha | Optional, side view facing right.                                                         |
| `theme-card`    | 640×360         | Picker thumbnail, no text.                                                                |

**Never scale an image non-uniformly.** Generate wide or tall natively, then crop or stitch. A
squashed banner is the most common failure (flattened letters and buildings). Check letters,
windows, faces and towers at full size.

**Alpha:** sprites need real transparency. If the model can't do it, generate on flat `#00FF00`, key it
out, and check the corners are alpha 0.

Check, for every file: no stray text or watermark, no logos, nothing stretched, the right size, WebP
under 500 KB (banner and backdrop) or 200 KB (the rest).

## 3. Manifest

Create `apps/web/src/fork/scenes/builtins/<camelName>/` with `assets/` (the WebP files only) and an
`index.ts` exporting the manifest. Copy `neonBoulevard/index.ts` as the template:

- `theme`: a dark `ThemeDefinition` spread from `T3_CODE_DARK_THEME_COLORS`. Its id is the scene id.
- `bannerFocus`: vertical background position for the full and compact banner. Tune so the banner
  story sits in view and the compact strip shows its most recognisable slice.
- `look`: frame, glow, accent, accentAlt, ink, paper, backdrop, surface, chatTint, headingStyle.
- `map`: ground, water, park, block, road, route, traveler (car, rider, paw, boat, sleigh, or a sprite), and optional trail.
  Choose terrain: city (default), forest, meadow, hills, desert or snow; path: asphalt (default),
  dirt, stone or boardwalk. Parchment style overlays any terrain. Optional tree, treeShadow,
  grass, contour and pathColor colors tune the details without changing journey routes.
- `flyby`: image, width and how often, or leave it out.

Register it in `BUILTIN_SCENES` in `sceneThemes.ts`. That one line puts it in Settings → Appearance
and the command palette.

## 4. Contrast and readability

- Body text on `surface` and on the chat tint must reach 4.5:1. Muted text must reach 3:1.
- The accent is used for headings, so it needs 3:1 against the chat tint.
- The chat backdrop must never compete with text. If it does, darken the tint, not the art.

Check: read a long reply, a code block, a diff and the composer placeholder in the theme.

## 5. Walk every surface

With `vp run dev`, pick the theme and visit each surface, in both banner sizes:

- A chat thread with a replay turn (Replay provider, `showcase`): a user message (avatar), a reply
  (headings), work rows, an approval, the composer.
- The right panel: diff, files and terminal.
- Workflows home, the settings dialog, pull requests and usage.
- The sidebar: thread rows are clickable, the map is not covering rows, the footer is reachable.
- The map: running (the traveler drives), waiting (it stops with an alert), parked (it sits at the
  last checkered flag), click a stop to jump, click a parked traveler to open that thread, enlarge.
- A narrow window (1100px) and a short one (760px); the banner starts compact below 860px.
- Reduced motion: the flyby and the banner ease are off.

Check: nothing is hidden behind art, every control is reachable, no text is clipped by a frame.

## 6. Performance

- Nothing animates all the time. The flyby is scheduled now and then; the map only moves while a
  thread is driving, one tick per block.
- Art loads only when its scene is active (it is referenced from the manifest, not global CSS).
- Total scene art under 1.5 MB.

## 7. Ship

- Every new file lives under `apps/web/src/fork/scenes/`. Any edit to an upstream file carries a
  `// fork(scenes)` marker.
- Run `vp run check:changed`.
- PR with before and after screenshots of a chat thread, the workflows page and the enlarged map.

## Studio scenes

Theme Studio scenes are `scenes/<slug>/scene.json` files an agent writes in the hidden studio project
(`apps/web/src/fork/scenes/studio/`), not built-in manifests. Every art file is optional there: without
a logo the word is set in type, and without a banner the banner draws `bannerGradient`, falling back to
the backdrop. The agent's brief is `studioInstructions.ts`; keep it in step with the rules above.

## Lessons so far

- A data attribute on `<html>` must never share a name with a selector meant for a child element.
  `data-scene-banner` on the root once made the whole page click-through.
- Map stops are placed by time, not by count: one block per `BLOCK_MS` while the agent works, so the
  car keeps moving and never jumps back. Waiting on the user is not distance.
- Chat rows are keyed by message id, not turn item id. Jumps must use the message id.

Map travelers use `map.traveler`: car, rider, paw, boat, sleigh, or an image marker such as
`{ "image": "marker.png", "scale": 1, "anchor": "ground" }`. Choose `map.trail: "prints"` for
creatures and `"line"` for vehicles (the default). An image marker must be a dedicated, tightly
cropped, transparent sprite, not the banner or a full scene: at least 96px on its short side, no
more than 512px, facing right, and readable at 26px. `scale` is 0.5–2 (default 1); `anchor` is
`"ground"` to put the sprite's bottom edge on the route or `"center"` for flying markers (the
default, which keeps older square markers in place). The renderer keeps the sprite's aspect ratio,
flips it to face travel direction, and falls back to the car when the file is missing or fails to
load. Legacy `vehicle` remains accepted.

Optional `ambient` sets `kind` (see `AmbientKind` in `apps/web/src/fork/scenes/ambient/types.ts`), `intensity`
(low or medium, default low), and `area` (frame by default; chat also draws faintly behind messages).
Canvas effects cap at 24fps, a shared budget of 240 particles across layers, and 1.5 DPR, resize with ResizeObserver, and stop while
hidden, blurred, below 20% battery while discharging, or under reduced motion. Reuse particles
without per-frame allocations. Neon flicker uses occasional timers instead of a frame loop.
