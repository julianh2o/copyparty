#!/usr/bin/env node
// playwright smoke-test for the drive-ui (?drive); runs against a live copyparty
//
// usage:
//   python3 -m copyparty -p 3923 --drive -e2dsa -a u1:pw1 -v /tmp/dsmoke:pub:r:rwmd,u1 &
//   npm i playwright && node scripts/test/drive-smoke.js http://127.0.0.1:3923 u1 pw1 /pub/
//
// covers M1+M2: boot without js errors, sign in, volume tree, list/grid + thumbnails,
// keyboard nav, deep links + back/forward, new folder, up2k upload (10 MiB, multi-chunk),
// dedup re-upload, paste-to-upload, folder upload; verifies results through ?ls

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

(async () => {
	const browser = await chromium.launch(Object.assign(
		process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
		// PW_INSECURE=1: reach the server through a fake hostname so the page is a non-secure context
		// (no crypto.subtle), exercising the sha512.ac.js fallback like plain-http lan access would
		process.env.PW_INSECURE ? { args: ["--host-resolver-rules=MAP drive-smoke.test 127.0.0.1"] } : {}));
	const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
	const page = await ctx.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => m.type() == "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

	console.log("boot (anonymous)");
	await page.goto(BASE + "/?drive");
	await page.waitForFunction(() => window.J_DRV == 2);
	ok(await page.isVisible("#acct .chip"), "sign-in chip shown when anonymous");
	const secure = await page.evaluate(() => window.isSecureContext);
	console.log("  (secure context: " + secure + ")");

	console.log("sign in");
	await page.click("#acct .chip");
	if (await page.isVisible("#l_u")) await page.fill("#l_u", USER);
	await page.fill("#l_p", PASS);
	await page.click("#sheet button[type=submit]");
	// server answers with a "hi <user>" page that redirects back to ?drive
	await page.waitForSelector("#acct .avatar", { timeout: 15000 });
	await page.waitForFunction(() => window.J_DRV == 2);
	ok(await page.isVisible("#acct .avatar"), "signed in; avatar shown");

	console.log("browse");
	await page.waitForSelector("#tree .tn a");
	const tree = await page.$$eval("#tree .tn > a", (a) => a.map((x) => x.getAttribute("href")));
	ok(tree.includes("#" + VOL), "volume tree lists " + VOL + " (" + tree.join(" ") + ")");
	await page.click('#tree a[href="#' + VOL + '"]');
	await page.waitForFunction((v) => window.DRV_T.S.path == v && window.DRV_T.S.ls, VOL);
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
	await page.goto(BASE + "/?drive#" + dir);
	await page.waitForFunction((v) => window.DRV_T.S.path == v && window.DRV_T.S.ls, dir);
	ok(await page.isVisible(".empty"), "deep link into the new empty folder shows the empty state");

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
	js = await ls(page, dir + encodeURIComponent("albüm") + "/sub/");
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
	await page.waitForFunction((v) => window.DRV_T.S.path == v, VOL);
	ok(true, "backspace goes up a folder");
	await page.goBack();
	await page.waitForFunction((v) => window.DRV_T.S.path == v, dir);
	ok(true, "browser back returns to the subfolder");

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

	ok(errors.length == 0, "no js errors (" + errors.join(" | ") + ")");
	console.log("\n" + nok + " checks passed; test folder: " + dir);
	await browser.close();
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
