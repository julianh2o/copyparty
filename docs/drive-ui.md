# drive-ui (experimental)

a Google-Drive-style front-end for copyparty, served by the same server at `?drive`
(for example `https://example.com/?drive` or `https://example.com/music/?drive`)

off by default; enable it with the global option `--drive`

it is a separate page beside the classic UI (same pattern as `?ru`, `?shares`, `md.html`)
and only uses the existing http api, so the server, wire protocol and permissions are unchanged:

* `?ls` for folder listings (including the top-level volume list)
* up2k (json handshake + chunk posts with `X-Up2k-Hash` / `X-Up2k-Wark`) for uploads
* `act=mkdir` / `act=login` form posts, `?pw=x` to sign out
* `?th=w` thumbnails

the classic UI is always one click away ("open in classic UI" in the sidebar)

## what's in it (milestones M1 + M2 of the spec)

* folder routing in the url hash (`?drive#/music/2026/`), deep links to files (`#/pics/a.jpg` opens the folder and selects the file), browser back/forward
* sidebar: Home, Recent, Starred (both stored in the browser), plus a lazy-loading volume/folder tree
* list view (sortable columns, comfortable/compact density) and grid view with server thumbnails
* listings are cached and revalidated in the background; folders are prefetched on hover; skeleton rows on first load
* selection: click, ctrl/cmd-click, shift-click ranges, marquee drag, ctrl-a
* keyboard: `J`/`K`/arrows, `Enter` open, `Backspace` up, `G` grid/list, `I` details, `/` filter, `Esc`
* details panel: size, dates, media tags, download, copy link
* new folder (optimistic, rolls back on error)
* uploads: drop anywhere (or onto a folder), paste from the clipboard, file and folder pickers;
  bottom-left task tray with per-file progress, overall speed + eta, pause/resume, cancel/retry,
  dedup detection ("already had 3 of these"), automatic retry/resume after network errors
* light/dark (follows the OS, or pick one), accent colors, mobile layout with a slide-out sidebar
* browsers too old for it are redirected to the classic UI

## not yet (later milestones)

rename/move/delete + undo, context menu, zip download (M3); server-side search (M4);
in-app lightbox/previews, tag editor (M5); i18n, "try the new look" link in the classic UI (M6)

## uploader notes

`up2k.js` is tightly coupled to the classic UI's dom, so `drive.js` contains a compact
reimplementation of the same up2k protocol (same chunk sizes as `up2k.js` / `u2c.py`, sha512
via `crypto.subtle`, or `deps/sha512.ac.js` on plain-http lan access). uploads from either UI
dedup against each other and resume each other's partial uploads

## testing

`tests/test_drive.py` checks the `--drive` toggle; `scripts/test/drive-smoke.js` is a playwright
smoke-test against a live server (sign in, browse, new folder, 10 MiB upload with checksum,
dedup, dropped-connection resume, folder upload, drag-drop, paste, keyboard, thumbnails):

```bash
mkdir -p /tmp/dsmoke && python3 -m copyparty -p 3923 --drive -e2dsa -a u1:pw1 -v /tmp/dsmoke:pub:r:rwmd,u1 &
npm i playwright && node scripts/test/drive-smoke.js http://127.0.0.1:3923 u1 pw1 /pub/
```
