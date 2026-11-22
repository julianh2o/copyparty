#!/usr/bin/env node
// playwright smoke-test for the drive-ui (the default directory view); runs against a live copyparty
//
// usage:
//   python3 -m copyparty -p 3923 -e2dsa -a u1:pw1 -v /tmp/dsmoke:pub:r:rwmd,u1 &
//   npm i playwright && node scripts/test/drive-smoke.js http://127.0.0.1:3923 u1 pw1 /pub/
//
// covers: boot without js errors, sign in, volume tree, list/grid + thumbnails,
// keyboard nav, real-path routing + back/forward + old ?drive#/x/ links, the ?legacy
// toggle, new folder, up2k upload (10 MiB, multi-chunk), dedup re-upload, paste-to-upload,
// folder upload, context menu (download, zip, rename, move, drag-to-move, delete + undo),
// phone crumbs + long-press; verifies results through ?ls

"use strict";

const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = process.argv[2] || "http://127.0.0.1:3923";
const USER = process.argv[3] || "u1";
const PASS = process.argv[4] || "pw1";
const VOL = process.argv[5] || "/pub/";
const RUN = "smoke-" + Date.now().toString(36);

let nok = 0;
function ok(cond, msg) {
	if (!cond) throw new Error("FAIL: " + msg);
	nok++;
	console.log("  ok  " + msg);
}

async function ls(page, path) {
	return page.evaluate(async (p) => {
		const r = await fetch(p + "?ls", { credentials: "same-origin" });
		return r.ok ? r.json() : { status: r.status };
	}, path);
}

function names(js) {
	return []
		.concat((js.dirs || []).map((x) => decodeURIComponent(x.href.split("?")[0])))
		.concat((js.files || []).map((x) => decodeURIComponent(x.href.split("?")[0])));
}

async function wait_tray_idle(page, timeout) {
	await page.waitForFunction(() => {
		const U = window.DRV_T.U;
		return U.tasks.length && U.tasks.every((t) => t.st == "done" || t.st == "err" || t.st == "cancel");
	}, null, { timeout: timeout || 60000 });
	return page.evaluate(() => window.DRV_T.U.tasks.map((t) => ({ name: t.name, st: t.st, msg: t.msg, skipped: t.skipped, size: t.size })));
}

async function at(page, p) {
	await page.waitForFunction((v) => window.DRV_T && window.DRV_T.S.path == v && window.DRV_T.S.ls, p);
}

// a row (list view) by file name
function row(name) {
	return '#pane [data-i]:has(.t[title="' + name.replace(/"/g, '\\"') + '"])';
}

(async () => {
	const browser = await chromium.launch(Object.assign(
		process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
		// PW_INSECURE=1: reach the server through a fake hostname so the page is a non-secure context
		// (no crypto.subtle), exercising the sha512.ac.js fallback like plain-http lan access would
		process.env.PW_INSECURE ? { args: ["--host-resolver-rules=MAP drive-smoke.test 127.0.0.1"] } : {}));
	const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true, viewport: { width: 1280, height: 800 } });
	const page = await ctx.newPage();
	const errors = [];
	const watch = (pg) => {
		pg.on("pageerror", (e) => errors.push(e.message));
		// (dev checkouts lack the packaged webdeps that the classic ui pulls in)
		pg.on("console", (m) => m.type() == "error" && !/Failed to load resource|\/\.cpr\/w\/deps\//.test(m.text()) && errors.push(m.text()));
	};
	watch(page);

	console.log("non-browser clients are unchanged");
	// (node itself can't resolve the PW_INSECURE fake hostname)
	const NB = BASE.replace("//drive-smoke.test", "//127.0.0.1");
	let r = await fetch(NB + VOL, { headers: { "User-Agent": "curl/8.5.0" } });
	let txt = await r.text();
	ok(r.ok && !/<html/i.test(txt), "curl gets the plaintext listing, not html");
	r = await fetch(NB + "/.cpr/w/drive.js");
	ok(r.status == 200, "/.cpr/w/drive.js is served");
	r = await fetch(NB + VOL + "?ls");
	ok(r.ok && "files" in (await r.json()), "?ls is json as before");

	console.log("boot (anonymous)");
	await page.goto(BASE + "/");
	await page.waitForFunction(() => window.J_DRV == 2);
	ok(true, "/ serves the drive-ui by default");
	ok(await page.isVisible("#acct .chip"), "sign-in chip shown when anonymous");
	const secure = await page.evaluate(() => window.isSecureContext);
	console.log("  (secure context: " + secure + ")");

	console.log("sign in");
	await page.click("#acct .chip");
	if (await page.isVisible("#l_u")) await page.fill("#l_u", USER);
	await page.fill("#l_p", PASS);
	await page.click("#sheet button[type=submit]");
	// server answers with a "hi <user>" page that redirects back to the same path
	await page.waitForSelector("#acct .avatar", { timeout: 15000 });
	await page.waitForFunction(() => window.J_DRV == 2);
	ok(await page.isVisible("#acct .avatar"), "signed in; avatar shown");
	ok(new URL(page.url()).pathname == "/", "back on / after signing in (" + page.url() + ")");

	console.log("browse");
	await page.waitForSelector("#tree .tn a");
	const tree = await page.$$eval("#tree .tn > a", (a) => a.map((x) => x.getAttribute("data-nav")));
	ok(tree.includes(VOL), "volume tree lists " + VOL + " (" + tree.join(" ") + ")");
	ok(await page.getAttribute('#tree a[data-nav="' + VOL + '"]', "href") == VOL, "tree links are real paths");
	await page.click('#tree a[data-nav="' + VOL + '"]');
	await at(page, VOL);
	ok(new URL(page.url()).pathname == VOL, "address bar shows the real folder path");
	const volname = decodeURIComponent(VOL.split("/")[1]);
	ok((await page.textContent("#crumbs")).includes(volname), "breadcrumbs show the volume");

	console.log("new folder");
	await page.click("#b_new");
	await page.click('#newmenu [data-a="mkdir"]');
	await page.fill("#sheet input[type=text]", RUN + " dïr");
	await page.click("#sheet button[type=submit]");
	await page.waitForFunction((n) => window.DRV_T.S.items.some((x) => x.name == n && x.dir), RUN + " dïr");
	await page.waitForTimeout(800);
	ok(names(await ls(page, VOL)).includes(RUN + " dïr/"), "folder created on server (unicode + space)");

	const dir = VOL + encodeURIComponent(RUN + " dïr") + "/";
	await page.goto(BASE + dir);
	await at(page, dir);
	ok(await page.isVisible(".empty"), "loading the folder url shows the new empty folder");

	console.log("upload 10 MiB (multi-chunk) via file picker");
	const big = crypto.randomBytes(10 * 1024 * 1024);
	await page.setInputFiles("#fpick", [{ name: "big.bin", mimeType: "application/octet-stream", buffer: big }]);
	let res = await wait_tray_idle(page, 120000);
	ok(res.length == 1 && res[0].st == "done", "upload finished: " + JSON.stringify(res));
	let js = await ls(page, dir);
	const bf = (js.files || []).find((x) => x.href == "big.bin");
	ok(bf && bf.sz == big.length, "server has big.bin at full size");
	// fetch in-page (cookies + host mapping apply there), hash in node
	const b64 = await page.evaluate(async (u) => {
		const b = new Uint8Array(await (await fetch(u)).arrayBuffer());
		let s = "";
		for (let a = 0; a < b.length; a += 32768) s += String.fromCharCode.apply(null, b.subarray(a, a + 32768));
		return btoa(s);
	}, dir + "big.bin");
	const dl = crypto.createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");
	ok(dl == crypto.createHash("sha256").update(big).digest("hex"), "downloaded bytes match the uploaded bytes");
	await page.waitForSelector('#pane [data-i] .t[title="big.bin"]');
	ok(true, "listing refreshed and shows big.bin");

	console.log("dedup: upload the same bytes again under another name");
	await page.click("#tray .th button[title=close]");
	await page.setInputFiles("#fpick", [{ name: "big-copy.bin", mimeType: "application/octet-stream", buffer: big }]);
	res = await wait_tray_idle(page);
	ok(res[0].st == "done" && res[0].skipped == big.length, "second upload skipped every chunk (dedup)");
	await page.waitForFunction(() => document.getElementById("tray").textContent.includes("already had 1 of these"), null, { timeout: 3000 });
	ok(true, "tray shows the dedup badge");

	console.log("resume after dropped connections");
	await page.click("#tray .th button[title=close]");
	let nfail = 0;
	await page.route("**/*", (route) => {
		const rq = route.request();
		if (rq.method() == "POST" && rq.headers()["x-up2k-hash"] && nfail < 3) {
			nfail++;
			return route.abort("connectionreset");
		}
		return route.continue();
	});
	const big2 = crypto.randomBytes(3 * 1024 * 1024 + 123);
	await page.setInputFiles("#fpick", [{ name: "flaky.bin", mimeType: "application/octet-stream", buffer: big2 }]);
	res = await wait_tray_idle(page, 90000);
	await page.unroute("**/*");
	ok(nfail == 3 && res[0].st == "done", "upload survived " + nfail + " dropped chunk posts");
	js = await ls(page, dir);
	ok((js.files || []).some((x) => x.href == "flaky.bin" && x.sz == big2.length), "flaky.bin complete on server");

	console.log("folder upload (webkitdirectory picker)");
	await page.click("#tray .th button[title=close]");
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmoke-"));
	fs.mkdirSync(path.join(tmp, "albüm", "sub"), { recursive: true });
	fs.writeFileSync(path.join(tmp, "albüm", "a.txt"), "aaa");
	fs.writeFileSync(path.join(tmp, "albüm", "sub", "b.txt"), "bbbb");
	await page.setInputFiles("#dpick", path.join(tmp, "albüm"));
	res = await wait_tray_idle(page);
	ok(res.length == 2 && res.every((x) => x.st == "done"), "folder upload done: " + JSON.stringify(res));
	const alb = dir + encodeURIComponent("albüm") + "/";
	js = await ls(page, alb + "sub/");
	ok(names(js).includes("b.txt"), "nested folders were created by the up2k handshake");
	fs.rmSync(tmp, { recursive: true, force: true });

	console.log("drag-and-drop onto the pane");
	await page.click("#tray .th button[title=close]");
	await page.evaluate(() => {
		const dt = new DataTransfer();
		dt.items.add(new File(["dropped!"], "dropped.txt", { type: "text/plain" }));
		const pane = document.getElementById("pane");
		for (const t of ["dragenter", "dragover", "drop"])
			pane.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
	});
	res = await wait_tray_idle(page);
	ok(res[0].st == "done" && res[0].name == "dropped.txt", "dropped file uploaded");
	ok(await page.isHidden("#dropz"), "drop overlay hidden again");

	console.log("paste-to-upload");
	await page.click("#tray .th button[title=close]");
	await page.click("#pane");
	await page.evaluate(() => {
		const dt = new DataTransfer();
		dt.items.add(new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], "image.png", { type: "image/png" }));
		const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true });
		document.dispatchEvent(ev);
	});
	res = await wait_tray_idle(page);
	ok(res[0].st == "done" && /^paste-\d{8}-\d{6}\.png$/.test(res[0].name), "pasted image uploaded as " + res[0].name);

	console.log("view + keyboard");
	await page.waitForTimeout(700);
	await page.click("#pane");
	await page.keyboard.press("Escape");
	await page.keyboard.press("j");
	await page.keyboard.press("j");
	ok(await page.evaluate(() => window.DRV_T.S.cur == 1), "j moves the cursor");
	await page.keyboard.press("g");
	ok(await page.isVisible("#pane .card"), "g switches to grid view");
	await page.keyboard.press("g");
	ok(await page.isVisible("#pane .row"), "g switches back to list view");
	await page.keyboard.press("Backspace");
	await at(page, VOL);
	ok(new URL(page.url()).pathname == VOL, "backspace goes up a folder (pushState: " + page.url() + ")");
	await page.goBack();
	await at(page, dir);
	ok(new URL(page.url()).pathname == dir, "browser back returns to the subfolder");
	await page.goForward();
	await at(page, VOL);
	await page.goBack();
	await at(page, dir);
	ok(true, "browser forward / back again");

	console.log("thumbnails in grid");
	const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
	await page.click("#tray .th button[title=close]");
	await page.setInputFiles("#fpick", [{ name: "dot.png", mimeType: "image/png", buffer: png }]);
	await wait_tray_idle(page);
	await page.waitForTimeout(700);
	await page.keyboard.press("g");
	const th = await page.waitForSelector('#pane .card img[src*="dot.png?th=w"]');
	ok(!!th, "grid requests a server thumbnail for images");
	await page.keyboard.press("g");
	await page.click("#tray .th button[title=close]");

	console.log("old links + file deep links");
	await page.goto(BASE + "/?drive#" + alb);
	await at(page, alb);
	ok(new URL(page.url()).pathname == alb && !new URL(page.url()).search && !new URL(page.url()).hash, "old ?drive#/x/ link lands on the real path (" + page.url() + ")");
	await page.goto(BASE + dir + "#dot.png");
	await at(page, dir);
	await page.waitForFunction(() => Object.keys(window.DRV_T.S.sel).some((k) => /dot\.png$/.test(k)));
	ok(true, "folder url + #file selects the file");

	console.log("context menu: read-only items");
	await page.goto(BASE + dir);
	await at(page, dir);
	await page.click(row("dropped.txt"), { button: "right" });
	await page.waitForSelector("#ctxmenu");
	let acts = await page.$$eval("#ctxmenu button", (b) => b.map((x) => x.getAttribute("data-a") + (x.disabled ? "-" : "")));
	ok(["dl", "link", "star", "info", "rename", "move", "delete"].every((a) => acts.includes(a)), "file menu: " + acts.join(" "));
	ok(await page.evaluate(() => Object.keys(window.DRV_T.S.sel).length == 1), "right-click selected the item");
	let [dlv] = await Promise.all([page.waitForEvent("download"), page.click('#ctxmenu [data-a="dl"]')]);
	ok(dlv.suggestedFilename() == "dropped.txt", "Download saves the file (" + dlv.suggestedFilename() + ")");
	ok(!(await page.$("#ctxmenu")), "menu closed after an action");
	ok(!(await page.$("#details .acts")), "details panel has no action buttons anymore");

	await page.click(row("dropped.txt"), { button: "right" });
	await page.click('#ctxmenu [data-a="star"]');
	ok(await page.isVisible(row("dropped.txt") + " .star.on"), "Star from the menu stars the row");
	await page.click(row("dropped.txt"), { button: "right" });
	ok((await page.textContent('#ctxmenu [data-a="star"]')).includes("Unstar"), "menu offers Unstar for a starred item");
	await page.keyboard.press("Escape");
	ok(!(await page.$("#ctxmenu")), "Esc closes the menu");

	// keyboard: Shift+F10 on the focused item, arrows, Enter
	await page.click(row("big.bin"));
	await page.keyboard.press("Shift+F10");
	await page.waitForSelector("#ctxmenu");
	ok(await page.evaluate(() => document.activeElement && document.activeElement.closest("#ctxmenu") != null), "Shift+F10 opens the menu with focus inside");
	await page.keyboard.press("ArrowDown");
	ok((await page.evaluate(() => document.activeElement.getAttribute("data-a"))) == "link", "arrow keys move through the items");
	await page.keyboard.press("Escape");

	// multi-select -> zip
	await page.click(row("big.bin"));
	await page.click(row("dropped.txt"), { modifiers: ["Control"] });
	await page.click(row("dropped.txt"), { button: "right" });
	await page.waitForSelector("#ctxmenu");
	acts = await page.$$eval("#ctxmenu button", (b) => b.map((x) => x.getAttribute("data-a") + (x.disabled ? "-" : "")));
	ok(acts.includes("zip") && acts.includes("rename-") && acts.includes("info-"), "multi-select menu: zip, single-item entries disabled (" + acts.join(" ") + ")");
	[dlv] = await Promise.all([page.waitForEvent("download"), page.click('#ctxmenu [data-a="zip"]')]);
	const zp = await dlv.path();
	const zb = fs.readFileSync(zp);
	ok(zb.slice(0, 2).toString() == "PK" && zb.length > 10 * 1024 * 1024, "Download as zip of the selection (" + zb.length + " bytes)");

	// folder: zip the whole thing
	await page.click(row("albüm"), { button: "right" });
	acts = await page.$$eval("#ctxmenu button", (b) => b.map((x) => x.getAttribute("data-a")));
	ok(acts[0] == "open" && acts.includes("zip"), "folder menu starts with Open and has zip (" + acts.join(" ") + ")");
	[dlv] = await Promise.all([page.waitForEvent("download"), page.click('#ctxmenu [data-a="zip"]')]);
	ok(/\.zip$/.test(dlv.suggestedFilename()), "folder zip download (" + dlv.suggestedFilename() + ")");

	// empty pane space -> folder menu
	const pb = await page.$eval("#pane", (p) => { const r = p.getBoundingClientRect(); return { w: r.width, h: r.height }; });
	await page.click("#pane", { button: "right", position: { x: pb.w / 2, y: pb.h - 12 } });
	acts = await page.$$eval("#ctxmenu button", (b) => b.map((x) => x.getAttribute("data-a")));
	ok(["mkdir", "upf", "upd", "zip", "link"].every((a) => acts.includes(a)), "right-click on empty space: folder menu (" + acts.join(" ") + ")");
	await page.keyboard.press("Escape");

	console.log("context menu: rename / move / delete");
	await page.click(row("dropped.txt"));
	await page.keyboard.press("F2");
	await page.waitForSelector("#sheet input[type=text]");
	await page.waitForTimeout(150);
	ok((await page.evaluate(() => { const i = document.querySelector("#sheet input[type=text]"); return i.value.slice(i.selectionStart, i.selectionEnd); })) == "dropped", "rename preselects the name without the extension");
	await page.fill("#sheet input[type=text]", "renamed & #ok.txt");
	await page.click("#sheet button[type=submit]");
	await page.waitForSelector(row("renamed & #ok.txt"));
	await page.waitForTimeout(700);
	let nn = names(await ls(page, dir));
	ok(nn.includes("renamed & #ok.txt") && !nn.includes("dropped.txt"), "F2 rename went through on the server");
	ok(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("drv_star") || "{}")).some((k) => /renamed/.test(k))), "the star followed the rename");

	// move via the ⋮ button + folder picker
	await page.hover(row("renamed & #ok.txt"));
	await page.click(row("renamed & #ok.txt") + " button.more");
	await page.click('#ctxmenu [data-a="move"]');
	await page.waitForSelector('#sheet .pi[data-p="' + alb + '"]');
	ok(await page.isDisabled("#sheet button[type=submit]"), "Move here is disabled in the item's own folder");
	await page.click('#sheet .pi[data-p="' + alb + '"]');
	await page.waitForSelector('#sheet .pi[data-p="' + alb + 'sub/"]');
	await page.waitForFunction(() => !document.querySelector("#sheet button[type=submit]").disabled);
	await page.click("#sheet button[type=submit]");
	await page.waitForSelector(row("renamed & #ok.txt"), { state: "detached" });
	await page.waitForTimeout(900);
	ok(names(await ls(page, alb)).includes("renamed & #ok.txt") && !names(await ls(page, dir)).includes("renamed & #ok.txt"), "Move to… moved it into albüm/");

	// drag-to-move onto a folder row
	await page.evaluate(() => {
		const find = (n) => [...document.querySelectorAll("#pane [data-i]")].find((e) => e.querySelector(".t").title == n);
		const dt = new DataTransfer(), s = find("dot.png"), d = find("albüm");
		const ev = (el, t) => el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
		ev(s, "dragstart");
		ev(d, "dragover");
		ev(d, "drop");
		ev(s, "dragend");
	});
	await page.waitForSelector(row("dot.png"), { state: "detached" });
	await page.waitForTimeout(900);
	ok(names(await ls(page, alb)).includes("dot.png"), "dragging a row onto a folder moves it");

	// ... and back out, onto a breadcrumb
	await page.goto(BASE + alb);
	await at(page, alb);
	await page.waitForSelector(row("dot.png"));
	await page.evaluate((dst) => {
		const s = [...document.querySelectorAll("#pane [data-i]")].find((e) => e.querySelector(".t").title == "dot.png");
		const d = document.querySelector('#crumbs [data-drop="' + dst + '"]');
		const dt = new DataTransfer();
		const ev = (el, t) => el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
		ev(s, "dragstart");
		ev(d, "dragover");
		ev(d, "drop");
		ev(s, "dragend");
	}, dir);
	await page.waitForSelector(row("dot.png"), { state: "detached" });
	await page.waitForTimeout(900);
	ok(names(await ls(page, dir)).includes("dot.png"), "dragging a row onto a breadcrumb moves it there");
	await page.goto(BASE + dir);
	await at(page, dir);

	// delete + undo
	await page.click(row("big-copy.bin"));
	await page.keyboard.press("Delete");
	ok(!(await page.$(row("big-copy.bin"))), "Del hides the item right away");
	await page.click('#toasts button:has-text("Undo")');
	await page.waitForSelector(row("big-copy.bin"));
	await page.waitForTimeout(5600);
	ok(names(await ls(page, dir)).includes("big-copy.bin"), "Undo kept the file on the server");

	await page.click(row("big-copy.bin"), { button: "right" });
	await page.click('#ctxmenu [data-a="delete"]');
	await page.waitForTimeout(1500);
	ok(names(await ls(page, dir)).includes("big-copy.bin"), "still on the server during the undo window");
	await page.waitForTimeout(4800);
	ok(!names(await ls(page, dir)).includes("big-copy.bin"), "deleted on the server once the undo window passed");

	await page.click(row("flaky.bin"), { button: "right" });
	await page.click('#ctxmenu [data-a="delete"]');
	await page.goto(BASE + VOL);
	await at(page, VOL);
	await page.waitForTimeout(800);
	ok(!names(await ls(page, dir)).includes("flaky.bin"), "a pending delete is sent when the page goes away");

	console.log("breadcrumbs");
	const deep = alb + "sub/";
	await page.setViewportSize({ width: 780, height: 700 });
	await page.goto(BASE + deep);
	await at(page, deep);
	const dc = await page.evaluate(() => {
		const cr = document.getElementById("crumbs"), m = cr.querySelector(".cmore");
		return { fits: cr.scrollWidth <= cr.clientWidth + 1, more: m && !m.hidden, last: cr.querySelector(".crumb.cur").textContent };
	});
	ok(dc.fits && dc.more && dc.last == "sub", "narrow desktop: the middle collapses into … (" + JSON.stringify(dc) + ")");
	await page.click("#crumbs .cmore");
	const hid = await page.$$eval("#crumbmenu a", (a) => a.map((x) => x.textContent));
	ok(hid.length >= 1 && !hid.includes("sub"), "… lists the hidden ancestors (" + hid.join(" / ") + ")");
	await page.keyboard.press("Escape");
	await page.setViewportSize({ width: 1600, height: 800 });
	await page.goto(BASE + deep);
	await at(page, deep);
	ok(await page.evaluate(() => document.querySelector("#crumbs .cmore").hidden && document.querySelectorAll("#crumbs .crumb").length == 5), "wide desktop: full trail");
	await page.setViewportSize({ width: 1280, height: 800 });

	console.log("phone: crumbs, ⋮, long-press");
	const mctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
	await mctx.addCookies(await ctx.cookies());
	const mp = await mctx.newPage();
	watch(mp);
	await mp.goto(BASE + deep);
	await at(mp, deep);
	const mc = await mp.$$eval("#crumbs > *", (e) => e.map((x) => x.className.replace("crumb ", "") + ":" + x.textContent));
	ok(mc.length == 4 && mc[0] == "cmore:…" && mc[1] == "up:albüm" && mc[3] == "cur:sub", "phone crumbs are … ‹ parent / current (" + mc.join(" ") + ")");
	await mp.tap("#crumbs .cmore");
	const anc = await mp.$$eval("#crumbmenu a", (a) => a.map((x) => x.textContent));
	ok(anc[0] == "Home" && anc[anc.length - 1] == "albüm" && anc.length == 4, "… opens the full ancestor path (" + anc.join(" / ") + ")");
	await mp.tap('#crumbmenu a[data-nav="' + dir + '"]');
	await at(mp, dir);
	ok(new URL(mp.url()).pathname == dir, "tapping an ancestor goes there");
	await mp.tap("#crumbs .crumb.up");
	await at(mp, VOL);
	ok(true, "tapping ‹ parent goes up");
	await mp.goBack();
	await at(mp, dir);
	ok(await mp.isVisible(row("big.bin") + " button.more"), "⋮ is always visible on touch");
	await mp.tap(row("big.bin") + " button.more");
	await mp.waitForSelector("#ctxmenu.bsheet");
	ok(await mp.isVisible("#ctxbg"), "⋮ opens the menu as a bottom sheet");
	await mp.tap("#ctxbg", { position: { x: 20, y: 20 } });
	ok(!(await mp.$("#ctxmenu")), "tapping outside closes it");
	await mp.evaluate((sel) => {
		const el = document.querySelector(sel), r = el.getBoundingClientRect();
		const t = new Touch({ identifier: 1, target: el, clientX: r.left + 40, clientY: r.top + 10 });
		el.dispatchEvent(new TouchEvent("touchstart", { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
	}, row("big.bin") + " .t");
	await mp.waitForTimeout(700);
	ok(await mp.isVisible("#ctxmenu.bsheet"), "long-press opens the menu");
	ok((await mp.textContent("#ctxmenu .mt")) == "big.bin", "bottom sheet is titled with the item");
	await mctx.close();

	console.log("legacy toggle");
	await page.goto(BASE + dir);
	await at(page, dir);
	ok((await page.getAttribute("#classic", "href")) == dir + "?legacy", "rail link points at the classic ui for this folder");
	await page.click("#classic");
	await page.waitForSelector("#files");
	ok(await page.evaluate(() => !window.J_DRV), "?legacy serves the classic ui");
	ok((await ctx.cookies()).some((c) => c.name == "cpp_legacy" && c.value == "1"), "?legacy set the sticky cookie");
	await page.goto(BASE + VOL);
	await page.waitForSelector("#files");
	ok(await page.evaluate(() => !window.J_DRV), "cookie sticks: the plain folder url serves classic");
	ok(await page.isVisible("#trydrive"), "classic ui shows 'try the new look'");
	await page.click("#trydrive");
	await page.waitForFunction(() => window.J_DRV == 2);
	await at(page, VOL);
	ok(new URL(page.url()).pathname == VOL && !new URL(page.url()).search, "try the new look returns to the drive-ui at the same path");
	ok(!(await ctx.cookies()).some((c) => c.name == "cpp_legacy" && c.value == "1"), "and the cookie is gone");

	ok(errors.length == 0, "no js errors (" + errors.join(" | ") + ")");
	console.log("\n" + nok + " checks passed; test folder: " + dir);
	await browser.close();
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
