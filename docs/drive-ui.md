# drive-ui

a Google-Drive-style front-end for copyparty; it is the default directory view, so
`https://example.com/` and `https://example.com/music/2026/` open it directly

it only uses the existing http api, so the server, wire protocol and permissions are unchanged:

* `?ls` for folder listings (including the top-level volume list)
* up2k (json handshake + chunk posts with `X-Up2k-Hash` / `X-Up2k-Wark`) for uploads
* `act=mkdir` / `act=login` / `act=zip` form posts, `?pw=x` to sign out
* `?move=` (rename / move), `?delete`, `?zip`, `?th=w` thumbnails

## the classic UI

* `?legacy` opens the classic UI (for example `/music/?legacy`) and remembers it with a
  cookie (`cpp_legacy=1`), so plain folder urls keep serving the classic UI on that browser
* the classic UI then shows a "try the new look" link (`?legacy=0`) which drops the cookie
* the sidebar link "open in classic UI" goes to `<current folder>?legacy`
* `--no-drive` turns the drive-ui off for everyone; the classic UI is then served everywhere
  and `?legacy` / `?drive` do nothing special
* `--drive` (which used to enable it) is still accepted, and does nothing

only the html directory page changes; everything else is served exactly like before:
`?ls`, `?b`, `?zip` / `?tar`, `?opds`, `?h`, `?doc`, `?k=` dirkeys, files, `.cpr/` resources,
index.html-for-folders (the `idxh` cookie), opengraph embeds (`--og`), and curl / fetch clients
(which still get the plaintext listing)

browsers too old for the drive-ui are redirected to `<path>?legacy`

## urls

* folders are real paths (`/music/2026/`), the same urls as the classic UI; navigation uses
  `history.pushState`, so back/forward, reload and open-in-new-tab all work
* a file is selected with a hash on its folder: `/pics/#a.jpg` (the file path itself serves the file)
* Recent and Starred are `/#!recent` and `/#!starred`
* old links from when the drive-ui lived at `?drive` (`/?drive#/music/`) still work; the server
  redirects `?drive` to the plain path and the page turns the `#/music/` hash into `/music/`

## what's in it

* sidebar: Home, Recent, Starred (both stored in the browser), plus a lazy-loading volume/folder tree
* list view (sortable columns, comfortable/compact density) and grid view with server thumbnails
* listings are cached and revalidated in the background; folders are prefetched on hover; skeleton rows on first load
* selection: click, ctrl/cmd-click, shift-click ranges, marquee drag, ctrl-a
* breadcrumbs: the full trail on desktop, collapsing the middle into a `…` dropdown when it does not
  fit; on phones `… ‹ parent / current`, where `…` lists every ancestor. crumbs and the dropdown
  are drop targets for uploads and moves
* context menu, on right-click, long-press (phones), the `⋮` button on every row / card,
  or `Shift+F10` / the menu key:
  * Open (folders) / Download (files), Download as zip (folders and multi-selections),
    Copy link, Star / Unstar, Details, Rename, Move to…, Delete
  * entries you lack permission for are hidden; single-item entries are disabled for multi-selections
  * right-click on empty space for the folder menu: new folder, upload files/folder, zip, copy link
  * becomes a bottom sheet on narrow screens
* rename (`F2`) and move (a folder picker, or drag rows onto a folder row, crumb or tree entry)
  update the view right away and roll back if the server says no; stars + recent follow along
* delete (`Del`) hides the items right away and shows an Undo toast for 5 seconds; the actual
  `?delete` is only sent when the toast expires, or right away (keepalive) if the page is closed.
  copyparty has no trash, so this is the only undo
* details panel: size, dates, media tags (actions live in the context menu)
* keyboard: `J`/`K`/arrows, `Enter` open, `Backspace` up, `G` grid/list, `I` details, `/` filter,
  `F2` rename, `Del` delete, `Shift+F10` menu, `Esc`
* new folder (optimistic, rolls back on error)
* uploads: drop anywhere (or onto a folder), paste from the clipboard, file and folder pickers;
  bottom-left task tray with per-file progress, overall speed + eta, pause/resume, cancel/retry,
  dedup detection ("already had 3 of these"), automatic retry/resume after network errors
* light/dark (follows the OS, or pick one), accent colors, mobile layout with a slide-out sidebar

## not yet

server-side search; in-app lightbox/previews, tag editor; i18n

## uploader notes

`up2k.js` is tightly coupled to the classic UI's dom, so `drive.js` contains a compact
reimplementation of the same up2k protocol (same chunk sizes as `up2k.js` / `u2c.py`, sha512
via `crypto.subtle`, or `deps/sha512.ac.js` on plain-http lan access). uploads from either UI
dedup against each other and resume each other's partial uploads

## testing

`tests/test_drive.py` checks the routing (default drive-ui, `--no-drive`, `?legacy` + its cookie,
`?legacy=0`, old `?drive` links, and that `?ls` / `?b` / curl / files are unchanged);
`scripts/test/drive-smoke.js` is a playwright smoke-test against a live server (sign in, browse,
real-path routing + back/forward, new folder, 10 MiB upload with checksum, dedup, dropped-connection
resume, folder upload, drag-drop, paste, keyboard, thumbnails, the context menu with download / zip /
rename / move / drag-to-move / delete + undo, desktop + phone breadcrumbs, long-press, the legacy toggle):

```bash
mkdir -p /tmp/dsmoke && python3 -m copyparty -p 3923 -e2dsa -a u1:pw1 -v /tmp/dsmoke:pub:r:rwmd,u1 &
npm i playwright && node scripts/test/drive-smoke.js http://127.0.0.1:3923 u1 pw1 /pub/
```
