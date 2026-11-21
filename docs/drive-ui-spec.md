# Drive-UI: a Google Drive-style front-end for copyparty

Status: draft v1 · Fork: `julianh2o/copyparty` (branch `hovudstraum`) · Target: server unchanged, UI-only project.

## 1. Why

copyparty's server is superb (up2k resumable dedup uploads, instant search, thumbnails, media streaming) but the web UI is a ~1,500-line dense page assembled from a 273 KB vanilla-JS monolith (`copyparty/web/browser.js`) + 78 KB CSS. It works everywhere down to a Nintendo 3DS, and that's exactly the constraint holding the UX back: everything is inline, tiny, and aimed at power users.

Goal: keep the server and its wire protocol 100% intact, and ship a second, modern front-end — Google Drive's interaction model over copyparty's engine. Think "Drive shell, copyparty muscle": resumable dedup uploads, tag search, and gapless audio that Drive doesn't have.

## 2. Architecture decision

**Option A — re-skin `browser.js` with CSS themes.** Cheap, but the DOM structure and interactions are baked into the monolith; we'd hit a ceiling fast. Rejected as the primary path (kept as a stopgap: ship a good starter theme under `contrib/themes/`).

**Option B — new SPA page (`drive.html`) served by the same server, talking only to existing HTTP endpoints.** The repo already does this for `md.html`, `shares.html`, `splash.html` — a separate page over the same API is an established pattern here. New code lives beside the old; legacy UI stays one click (and `/legacy`) away. **Chosen.**

**Option C — rewrite the server + API.** Out of scope forever, probably. The single-portable-file magic depends on it staying boring.

Hard rules:
- Zero new server endpoints for v1. Everything below must map to what `browser.js` already calls: `?ls` (JSON listings), up2k (`?allocate` + `?upload`), `?move=`, `?delete`, `?mkdir`, `?gs`/`?us` (search), `?tags`, `?album`, thumbnail URLs, `?cache=`/raw for previews.
- Reuse `up2k.js` as the upload engine (it already handles chunking, dedup-skips, resume, live-partial downloads) and `util.js` where practical.
- Works against any copyparty ≥ 1.17; feature-detect via the `/` top-index JSON the splash page already parses.

## 3. Design principles

1. **Quiet chrome, loud content.** Neutral greys, one accent (copyparty trumpet-gold available as opt-in), 8px radii, generous whitespace, real iconography. Files are the interface.
2. **Zero clicks for the common things.** Upload = drop anywhere. Preview = single click. Share = right-click → link. Navigate = breadcrumbs or ← /.
3. **Everything reachable by keyboard.** J/K, arrows, Enter, Del, Cmd/Ctrl+K palette. (Hotkeys exist today; we keep the good ones and make them discoverable.)
4. **Perceived speed is the feature.** Optimistic UI: renames/moves/deletes update instantly and roll back on error; instant directory swap with cached listings; skeleton rows, never spinners.
5. **Degrade honestly.** No JS framework cruft on low-end devices; if a client can't run the SPA, auto-redirect to the classic UI. The 3DS keeps its dignity.

## 4. Information architecture

```
┌────────────────────────────────────────────────────────┐
│ ☰  ‹  ›   home / photos / 2026                        ⌕ ⋯ │  top bar: back/fwd, breadcrumbs, search
├──────────┬─────────────────────────────────┬───────────┤
│ Home     │  ▦ ⌥ view switch   ↑ name ⇅     │           │
│ Recent   │  ┌───────────────────────────┐  │  Details  │
│ Shared   │  │ 🖼 photo.jpg    2.1 MB ⋯  │  │  side     │
│ Starred  │  │ 🎬 clip.mp4    88 MB  ⋯  │  │  panel    │
│ Trash    │  │ 📁 2025/        —     ⋯  │  │  (collap- │
│ ────────  │  └───────────────────────────┘  │  sible)   │
│ [volumes │                                 │           │
│  / users]│   drop-anywhere upload zone     │           │
└──────────┴─────────────────────────────────┴───────────┘
```

- Left rail: Home / Recent / Shared-with-link / Starred / Trash, then the volume+account tree from the top-index. Starred & Recent are client-side (localStorage + `?tags` where the server supports it); Trash = copyparty has none, so v1 maps it to "deletes are real, with a 5 s undo toast."
- Main pane: list ⇄ grid toggle, multi-select (click, shift-range, ⌘-add, marquee drag), sortable columns.
- Details panel: name/size/mtime/hash, image EXIF-ish info, audio/video duration, inline tag editor, link/share controls, "open in classic UI."

## 5. Feature spec (v1 = P0, v1.x = P1)

### Navigation & browsing — P0
- Instant SPA routing per folder (`#/path/`), back/forward, deep links shareable.
- Folder contents cached with ETag revalidation; prefetch on hover.
- Grid view with big thumbnails (server already generates them), list view density toggle (comfortable/compact).
- Breadcrumb dropdown showing sibling folders (Drive-style).
- Sort by name/date/size; folders-first toggle.

### Uploads — P0
- Drop anywhere → bottom-left up2k task tray: per-file progress, overall speed, dedup-skip badges ("already had 3 of these 🙂"), pause/cancel, resume after reconnect.
- Paste-to-upload and folder-drop (webkitdirectory).
- Upload progress uses real up2k chunk stats, not fake easing.

### Search — P0
- Global search box → `?gs` (names) with debounced inline results; advanced sheet for size/date/tag queries using existing syntax (`size>10M`, `-word`).
- Recent searches + saved searches in localStorage.

### File ops — P0
- Context menu (right-click + `⋯`): open, preview, download, copy link, rename, move/copy (server-side `?move=`; copy where permitted), star, delete with undo toast.
- Rename/move inline and optimistic with rollback.
- Multi-select ops: bulk download (zip on servers with zip support), bulk move, bulk delete.

### Preview — P0 lightbox, P1 viewer shell
- P0: keyboard-navigable lightbox (images via existing thumbs/full, video/audio inline, PDF/text/markdown inline).
- P1: Drive-style viewer route `#/view/path` with URL sharing, prev/next within folder, subtitle-aware video, and the existing gapless audio player promoted to a persistent bottom bar.

### Sharing — P0 basic
- "Copy link" honors existing volflags/auth (if the path is already world-readable → clean link; else offer `?pw` / user-auth explanation, no fake promises).
- P1: native share dialog (`navigator.share`) on mobile.

### Look & feel — P0
- Light + dark, following `prefers-color-scheme`, accent picker in a small settings sheet (persisted per browser).
- i18n: reuse the `tl/*.js` catalogs already shipped.
- Touch: mobile layout with bottom sheet for details, long-press context menu.

## 6. Non-goals (v1)

- No auth changes, no user management UI (volumes/users stay server-config).
- No sync client, no conflict resolution, no offline editing — copyparty is a server, not a sync service.
- No editing of files in place except markdown (reuse `mde.js` pattern later).
- No new server dependencies; the single-file `.py` stays single-file.

## 7. Tech approach

- **Vanilla TS + a micro-renderer** (lit or hyperscript-class), no build-required runtime deps, bundled/minified the way `browser.js` already ships. Target ≤ 150 KB gz for the whole app.
- Same CSP-safe constraints as the existing web files; no dev-server needed to hack on it — `python3 -m copyparty` serves it.
- Ship behind `--drive` / volflag off by default in the fork; `/drive/` URL + a "try the new look" pill on the classic UI.
- Playwright smoke suite against a live server: login → browse → upload 10 MB → rename → search → delete → undo.

## 8. Milestones

| # | Deliverable | Est. |
|---|---|---|
| M0 | Starter theme for the **existing** UI (spacing, icons, dark mode) — instant quality-of-life while the rest cooks | small |
| M1 | `drive.html` skeleton: top-index → volume tree → folder list/grid with real thumbnails + routing | medium |
| M2 | up2k task tray + drag-drop upload + paste | medium |
| M3 | Context menu, optimistic rename/move/delete + undo, multi-select, zip download | medium |
| M4 | Search UI (incl. size/date/tag syntax help), breadcrumbs siblings menu | small |
| M5 | Lightbox/preview v1, details panel, tags editor | medium |
| M6 | Polish: mobile layout, i18n wiring, perf pass, "try it" toggle, upstream PR to 9001 | ongoing |

## 9. Risks

- **API drift:** documented in-repo but not a stable contract → pin tested behavior, feature-detect, fail soft to classic UI per-route.
- **Monolith envy:** `browser.js` hides real edge cases (URL quoting, unicode names, permissions errors surfacing as HTML). Budget an edge-case suite early, steal its battle-tested helpers from `util.js`.
- **Upstream appetite:** 9001 loves the retro UI. The fork stays rebaseable, M0 theme and the new page are separate tracks, so even if upstream says "no thanks," the fork lives well.
