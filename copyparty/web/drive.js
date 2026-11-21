"use strict";

// copyparty drive-ui (experimental); a google-drive-style shell over the
// regular copyparty http api (?ls, up2k, ?mkdir, ...); no new endpoints.
//
// M1: top-index -> volume tree -> folder list/grid + thumbnails + routing
// M2: up2k upload tray, drop-anywhere, paste, folder-drop
//
// the up2k client below is a compact reimplementation of the wire protocol
// that up2k.js speaks (handshake json -> chunk posts -> confirm handshake);
// up2k.js itself is welded to browser.js' dom so it can't be reused as-is

(function () {

var WIN = window,
	DOC = document,
	STG = null,
	HTM = DOC.documentElement,
	TOUCH = WIN.matchMedia && WIN.matchMedia('(pointer: coarse)').matches,
	coll = WIN.Intl && Intl.Collator ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;

try {
	STG = WIN.localStorage;
	STG.setItem('drv_t', '1');
}
catch (ex) {
	STG = null;
}

function sread(k, dv) {
	try {
		var v = STG && STG.getItem('drv_' + k);
		return v === null || v === undefined ? dv : JSON.parse(v);
	}
	catch (ex) {
		return dv;
	}
}
function swrite(k, v) {
	try {
		if (STG)
			STG.setItem('drv_' + k, JSON.stringify(v));
	}
	catch (ex) { }
}

//
// tiny dom helpers
//

function ebi(id) {
	return DOC.getElementById(id);
}
function QS(s, r) {
	return (r || DOC).querySelector(s);
}
function QSA(s, r) {
	return Array.prototype.slice.call((r || DOC).querySelectorAll(s));
}

// h('div.cls#id', {attrs}, children...) -- text children are always textContent (no innerHTML from data)
function h(tag, attrs) {
	var m = tag.split(/(?=[.#])/),
		el = DOC.createElement(m[0] || 'div');

	for (var a = 1; a < m.length; a++) {
		if (m[a][0] == '.')
			el.classList.add(m[a].slice(1));
		else
			el.id = m[a].slice(1);
	}
	var kids = Array.prototype.slice.call(arguments, 2);
	if (attrs && (typeof attrs != 'object' || attrs.nodeType || Array.isArray(attrs))) {
		kids.unshift(attrs);
		attrs = null;
	}
	if (attrs)
		for (var k in attrs) {
			var v = attrs[k];
			if (v === null || v === undefined || v === false)
				continue;
			if (k.slice(0, 2) == 'on')
				el.addEventListener(k.slice(2), v);
			else if (k == 'html')
				el.innerHTML = v;  // only ever used with constant svg strings
			else if (k == 'style' && typeof v == 'object')
				for (var sk in v) el.style.setProperty(sk, v[sk]);
			else
				el.setAttribute(k, v === true ? '' : v);
		}
	add(el, kids);
	return el;
}
function add(el, kids) {
	for (var a = 0; a < kids.length; a++) {
		var c = kids[a];
		if (c === null || c === undefined || c === false)
			continue;
		if (Array.isArray(c))
			add(el, c);
		else
			el.appendChild(c.nodeType ? c : DOC.createTextNode(c + ''));
	}
}
function clr(el) {
	while (el.firstChild)
		el.removeChild(el.firstChild);
	return el;
}

//
// icons (material-ish 24px paths)
//

var IP = {
	menu: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z',
	back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
	fwd: 'M4 11h12.2l-5.6-5.6L12 4l8 8-8 8-1.4-1.4 5.6-5.6H4z',
	up: 'M4 12l1.4 1.4 5.6-5.6V20h2V7.8l5.6 5.6L20 12l-8-8z',
	down: 'M20 12l-1.4-1.4-5.6 5.6V4h-2v12.2l-5.6-5.6L4 12l8 8z',
	search: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 9.5 16a6.5 6.5 0 0 0 4.2-1.6l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9',
	cog: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7 7 0 0 0-1.7-1L15 3h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7 7 0 0 0 1.7 1L11 21h4l.4-2.6a7 7 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7',
	grid: 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z',
	list: 'M3 4h18v3H3zm0 6.5h18v3H3zM3 17h18v3H3z',
	info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16',
	plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z',
	home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
	clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16m.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7z',
	star: 'M12 17.3 18.2 21l-1.6-7L22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2 7.5 14l-1.7 7z',
	staro: 'M22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2 7.5 14l-1.7 7 6.2-3.7 6.2 3.7-1.6-7zm-10 6.2-3.8 2.3 1-4.3-3.3-2.9 4.4-.4L12 6.1l1.7 4 4.4.4-3.3 2.9 1 4.3z',
	folder: 'M10 4H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z',
	file: 'M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9z',
	img: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2M8.5 13.5l2.5 3 3.5-4.5 4.5 6H5z',
	vid: 'M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h16a2 2 0 0 0 2-2V4z',
	aud: 'M12 3v10.6A4 4 0 1 0 14 17V7h4V3z',
	doc: 'M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8zm2 16H8v-2h8zm0-4H8v-2h8zm-3-5V3.5L18.5 9z',
	pdf: 'M20 2H8a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2m-8.5 7.5c0 .8-.7 1.5-1.5 1.5H9v2H7.5V7H10c.8 0 1.5.7 1.5 1.5zm5 2c0 .8-.7 1.5-1.5 1.5h-2.5V7H15c.8 0 1.5.7 1.5 1.5zm4-3H19v1h1.5V11H19v2h-1.5V7h3zM9 9.5h1v-1H9zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4zm10 5.5h1v-3h-1z',
	sheet: 'M19 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2m0 8h-8v8H9v-8H5V9h4V5h2v4h8z',
	arc: 'M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m-2 6h-2v2h2v2h-2v2h-2v-2h2v-2h-2v-2h2v-2h-2V8h2v2h2z',
	code: 'M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6z',
	upload: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
	dl: 'M19 9h-4V3H9v6H5l7 7zM5 18v2h14v-2z',
	link: 'M3.9 12c0-1.7 1.4-3.1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12M8 13h8v-2H8zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10',
	x: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
	pause: 'M6 19h4V5H6zm8-14v14h4V5z',
	play: 'M8 5v14l11-7z',
	chev: 'M10 6 8.6 7.4 13.2 12l-4.6 4.6L10 18l6-6z',
	chevd: 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z',
	chevu: 'M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z',
	ok: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
	warn: 'M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z',
	retry: 'M17.7 6.3A8 8 0 1 0 19.7 14h-2.1a6 6 0 1 1-1.4-6.2L13 11h7V4z',
	lock: 'M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2m-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4m3.1-9H8.9V6a3.1 3.1 0 0 1 6.2 0z',
	empty: 'M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m0 12H4V8h16z'
};
function svg(n) {
	return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + (IP[n] || IP.file) + '"/></svg>';
}
function ico(n, cls) {
	return h('span.' + (cls || 'ico'), { html: svg(n) });
}

//
// file kinds
//

var KINDS = {
	img: ['jpg jpeg png gif webp avif jxl bmp heic heif tif tiff svg ico jfif', '#d93025'],
	vid: ['mp4 mkv webm mov avi m4v wmv flv ts mts m2ts mpg mpeg 3gp ogv', '#d93025'],
	aud: ['mp3 flac ogg opus m4a aac wav wma alac ape wv aif aiff mka mpc dsf', '#9334e6'],
	pdf: ['pdf', '#d93025'],
	doc: ['txt md doc docx odt rtf epub log nfo srt vtt ass', '#1a73e8'],
	sheet: ['xls xlsx ods csv tsv', '#188038'],
	arc: ['zip 7z rar tar gz xz bz2 zst tgz txz iso cab lz4 deb rpm apk', '#80868b'],
	code: ['js mjs py ts c h cpp hpp cs rs go java kt sh bat ps1 json html htm css xml yaml yml toml ini conf php rb lua sql', '#e37400']
},
	EXT2K = {};

for (var k in KINDS)
	KINDS[k][0].split(' ').forEach(function (e) {
		EXT2K[e] = k;
	});

function kind(it) {
	if (it.dir)
		return 'folder';
	return EXT2K[it.ext] || 'file';
}
function fico(it) {
	var k = kind(it),
		c = k == 'folder' ? 'var(--fg2)' : (KINDS[k] || ['', 'var(--fg3)'])[1];
	return h('span.fi', { html: svg(k), style: { '--c': c } });
}
function has_thumb(it) {
	var k = kind(it);
	return k == 'img' || k == 'vid' || k == 'aud';
}

//
// formatting
//

function hsize(n) {
	if (n === undefined || n === null || n < 0)
		return '—';
	if (n < 1024)
		return n + ' B';
	var u = ['KB', 'MB', 'GB', 'TB', 'PB'], a = -1;
	while (n >= 1024 && a < u.length - 1) {
		n /= 1024;
		a++;
	}
	return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + u[a];
}
function hdate(ts, full) {
	if (!ts)
		return '—';
	var d = new Date(ts * 1000),
		now = new Date();

	if (full)
		return d.toLocaleString();
	if (d.toDateString() == now.toDateString())
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	if (d.getFullYear() == now.getFullYear())
		return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
	return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}
function hdur(s) {
	if (!isFinite(s) || s < 0)
		return '';
	s = Math.round(s);
	if (s < 60)
		return s + 's';
	if (s < 3600)
		return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
	return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

//
// paths; S.path is always the url-encoded vpath with leading and trailing slash, without SR
//

function uenc(s) {
	return encodeURIComponent(s).replace(/%2F/gi, '/');
}
function udec(s) {
	try {
		return decodeURIComponent(s);
	}
	catch (ex) {
		return s;
	}
}
function penc(s) {
	// raw path -> encoded path, keeping slashes
	return s.split('/').map(function (x) {
		return encodeURIComponent(x);
	}).join('/');
}
function pname(p) {
	var v = p.replace(/\/$/, '').split('/').pop();
	return v ? udec(v) : '';
}
function pparent(p) {
	var v = p.replace(/\/$/, '');
	return v.slice(0, v.lastIndexOf('/') + 1) || '/';
}

//
// app state
//

var S = {
	route: null,     // '/x/' or '!recent' / '!starred'
	path: '/',
	ls: null,        // last ?ls json for S.path
	items: [],       // all items in folder (normalized)
	vis: [],         // visible items (sorted+filtered)
	sel: {},         // path -> 1
	cur: -1,         // focused index in vis
	anchor: -1,
	view: sread('view', 'list'),
	sort: sread('sort', 'name'),
	desc: sread('desc', false),
	dfirst: sread('dfirst', true),
	filter: '',
	perms: [],
	err: null
},
	CACHE = {},  // path -> {t, txt, js}
	INFLIGHT = {};

function lsurl(p) {
	return SR + p + '?ls';
}

function fetch_ls(p, force) {
	var c = CACHE[p];
	if (!force && c && Date.now() - c.t < 2500)
		return Promise.resolve(c);

	if (INFLIGHT[p])
		return INFLIGHT[p];

	var pr = fetch(lsurl(p), {
		credentials: 'same-origin',
		headers: { 'Accept': 'application/json' },
		cache: 'no-cache'
	}).then(function (r) {
		return r.text().then(function (txt) {
			delete INFLIGHT[p];
			if (!r.ok) {
				var e = new Error(strip_html(txt) || ('error ' + r.status));
				e.status = r.status;
				throw e;
			}
			var js;
			try {
				js = JSON.parse(txt);
			}
			catch (ex) {
				var e = new Error('expected json from ?ls, got something else');
				e.status = 0;
				throw e;
			}
			var old = CACHE[p],
				ret = { t: Date.now(), txt: txt, js: js, changed: !old || old.txt !== txt };
			CACHE[p] = ret;
			return ret;
		});
	}, function (ex) {
		delete INFLIGHT[p];
		throw ex;
	});
	INFLIGHT[p] = pr;
	return pr;
}

function strip_html(t) {
	t = (t || '') + '';
	if (t.indexOf('<') + 1) {
		var d = DOC.createElement('div');
		d.innerHTML = t.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
		t = d.textContent || '';
	}
	return t.replace(/\s+/g, ' ').trim().slice(0, 400);
}

function norm(base, e, dir) {
	var href = e.href || '',
		qi = href.indexOf('?'),
		q = qi + 1 ? href.slice(qi) : '',
		rel = qi + 1 ? href.slice(0, qi) : href;

	if (dir && !/\/$/.test(rel))
		rel += '/';

	return {
		path: base + rel,
		q: q,
		name: pname(rel),
		dir: dir,
		sz: e.sz,
		ts: e.ts,
		ext: dir ? '' : (rel.indexOf('.') + 1 ? rel.split('.').pop().toLowerCase() : ''),
		tags: e.tags || {}
	};
}

function items_from(p, js) {
	var ret = [];
	(js.dirs || []).forEach(function (e) {
		ret.push(norm(p, e, true));
	});
	(js.files || []).forEach(function (e) {
		ret.push(norm(p, e, false));
	});
	return ret;
}

function sorted(arr) {
	var key = S.sort,
		mul = S.desc ? -1 : 1,
		cmp = coll ? coll.compare : function (a, b) {
			return a < b ? -1 : a > b ? 1 : 0;
		};

	return arr.slice().sort(function (a, b) {
		if (S.dfirst && a.dir != b.dir)
			return a.dir ? -1 : 1;

		var r = 0;
		if (key == 'sz')
			r = (a.sz || 0) - (b.sz || 0);
		else if (key == 'ts')
			r = (a.ts || 0) - (b.ts || 0);
		else if (key == 'ext')
			r = cmp(a.ext, b.ext);

		if (!r)
			r = cmp(a.name, b.name);

		return r * mul;
	});
}

function can(perm) {
	return S.perms.indexOf(perm) + 1;
}

//
// recent + starred (client-side)
//

function recent_add(it) {
	var r = sread('recent', []).filter(function (x) {
		return x.path != it.path;
	});
	r.unshift({ path: it.path, q: it.q || '', name: it.name, dir: it.dir, sz: it.sz, ts: it.ts, ext: it.ext, at: Date.now() });
	swrite('recent', r.slice(0, 60));
}
function stars() {
	return sread('star', {});
}
function is_star(it) {
	return !!stars()[it.path];
}
function star_toggle(it) {
	var st = stars();
	if (st[it.path])
		delete st[it.path];
	else
		st[it.path] = { path: it.path, q: it.q || '', name: it.name, dir: it.dir, sz: it.sz, ts: it.ts, ext: it.ext, at: Date.now() };
	swrite('star', st);
	return !!st[it.path];
}

//
// routing
//

function cur_hash() {
	var hs = location.hash.slice(1);
	if (!hs || hs == '/')
		return '/';
	if (hs[0] == '!')
		return hs;
	if (hs[0] != '/')
		hs = '/' + hs;
	return hs;
}

function go(p) {
	if (cur_hash() == p)
		return route();
	location.hash = '#' + p;
}

var want_sel = null;

function route() {
	var r = cur_hash();
	close_menus();
	HTM.classList.remove('rail');

	if (r[0] == '!')
		return show_special(r);

	if (!/\/$/.test(r)) {
		// deep link to a file; open the folder and select it
		want_sel = r;
		r = pparent(r);
	}
	show_dir(r);
}

//
// rendering: chrome
//

function render_crumbs() {
	var cr = clr(ebi('crumbs'));

	if (S.route[0] == '!') {
		cr.appendChild(h('a', { href: '#' + S.route }, S.route == '!recent' ? 'Recent' : 'Starred'));
		return;
	}
	var parts = S.path.split('/').filter(Boolean),
		acc = '/';

	cr.appendChild(h('a', { href: '#/', title: 'home' }, 'Home'));
	parts.forEach(function (p) {
		acc += p + '/';
		cr.appendChild(h('span.sep', { html: svg('chev').replace('<svg', '<svg width="18" height="18"') }));
		cr.appendChild(h('a', { href: '#' + acc, title: udec(p) }, udec(p)));
	});
	setTimeout(function () {
		cr.scrollLeft = 1e9;
	}, 1);
}

function render_places() {
	QSA('#places a').forEach(function (a) {
		var p = a.getAttribute('data-p');
		a.classList.toggle('on',
			(p == 'home' && S.route == '/') ||
			(p == 'recent' && S.route == '!recent') ||
			(p == 'starred' && S.route == '!starred'));
	});
	ebi('classic').setAttribute('href', SR + (S.route[0] == '!' ? '/' : S.path));
}

function render_tools() {
	ebi('sort').value = S.sort;
	ebi('b_dir').innerHTML = svg(S.desc ? 'down' : 'up');
	ebi('b_view').innerHTML = svg(S.view == 'grid' ? 'list' : 'grid');
	ebi('b_view').title = S.view == 'grid' ? 'list view (G)' : 'grid view (G)';
	ebi('b_info').classList.toggle('on', !ebi('details').hidden);
	ebi('b_back').disabled = false;
	var wr = S.route[0] != '!' && can('write');
	ebi('b_new').disabled = false;
	QS('#newmenu [data-a="mkdir"]').disabled = !wr;
}

function render_title() {
	var t = ebi('title'), n = 0, nd = 0, sz = 0;
	S.items.forEach(function (it) {
		if (it.dir) nd++;
		else { n++; sz += it.sz || 0; }
	});
	var txt = [];
	if (nd) txt.push(nd + (nd == 1 ? ' folder' : ' folders'));
	if (n) txt.push(n + (n == 1 ? ' file' : ' files') + ', ' + hsize(sz));
	if (S.filter) txt.push('filtered: ' + S.vis.length + ' shown');
	if (S.route[0] != '!' && !S.err && !can('write') && S.ls) txt.push('read-only');
	t.textContent = txt.join(' · ');

	var nm = S.route == '!recent' ? 'Recent' : S.route == '!starred' ? 'Starred' : (pname(S.path) || 'Home');
	DOC.title = nm + ' · ' + (S.srv || 'copyparty');
}

function render_acct() {
	var a = clr(ebi('acct'));
	if (DRV.acct == '*') {
		a.appendChild(h('button.chip', { onclick: show_login }, ico('lock'), 'Sign in'));
	}
	else {
		a.appendChild(h('button.avatar', {
			title: 'signed in as ' + DRV.acct,
			onclick: show_acct
		}, DRV.acct.slice(0, 1)));
	}
}

//
// rendering: the file pane
//

function skel() {
	var p = clr(ebi('pane'));
	for (var a = 0; a < 9; a++)
		p.appendChild(h('div.skel', h('i'), h('i', { style: { width: (30 + (a * 37) % 45) + '%' } })));
}

function empty(icon, big, small, btn) {
	var p = clr(ebi('pane'));
	p.appendChild(h('div.empty', ico(icon), h('div.big', big), small ? h('div', small) : null, btn || null));
}

function apply_vis() {
	var f = S.filter.toLowerCase(),
		v = S.items;
	if (f)
		v = v.filter(function (it) {
			return it.name.toLowerCase().indexOf(f) + 1;
		});
	S.vis = S.route == '!recent' ? v : sorted(v);
}

var RCHUNK = 400, rtimer = null;

function render_pane() {
	apply_vis();
	render_title();

	var p = clr(ebi('pane'));
	clearTimeout(rtimer);

	if (S.err)
		return render_err();

	if (!S.vis.length) {
		if (S.filter)
			return empty('search', 'No matches', 'nothing in this folder matches "' + S.filter + '"');
		if (S.route == '!recent')
			return empty('clock', 'Nothing here yet', 'folders you visit and files you open show up here');
		if (S.route == '!starred')
			return empty('staro', 'No starred items', 'hover a file or folder and click the star');
		if (can('write'))
			return empty('upload', 'Drop files here', 'or use the New button; folders work too',
				h('button.btn.acc', { onclick: function () { ebi('fpick').click(); } }, 'Upload files'));
		return empty('empty', 'This folder is empty');
	}

	var sp = S.route[0] == '!';

	if (S.view == 'grid') {
		var dirs = S.vis.filter(function (x) { return x.dir; }),
			files = S.vis.filter(function (x) { return !x.dir; });

		if (dirs.length && S.dfirst) {
			p.appendChild(h('div.gsec', 'Folders'));
			p.appendChild(h('div.grid.gd'));
			if (files.length) {
				p.appendChild(h('div.gsec', 'Files'));
			}
		}
		p.appendChild(h('div.grid.gf'));
	}
	else {
		var hd = h('div.lhead'),
			cols = [['name', 'Name'], ['ts', sp ? 'Modified' : 'Last modified'], ['sz', 'File size']];
		cols.forEach(function (c) {
			var el = h('span' + (c[0] == 'ts' ? '.m' : c[0] == 'sz' ? '.s' : ''), {
				onclick: function () {
					if (S.sort == c[0])
						S.desc = !S.desc;
					else {
						S.sort = c[0];
						S.desc = c[0] != 'name';
					}
					swrite('sort', S.sort);
					swrite('desc', S.desc);
					render_tools();
					render_pane();
				}
			}, c[1], S.sort == c[0] ? (S.desc ? ' ↓' : ' ↑') : '');
			if (S.sort == c[0])
				el.classList.add('on');
			if (c[0] == 'sz')
				el.style.textAlign = 'right';
			hd.appendChild(el);
		});
		hd.appendChild(h('span'));
		p.appendChild(hd);
		p.appendChild(h('div.lbody'));
	}

	var n = 0;
	function more() {
		var lim = Math.min(S.vis.length, n + RCHUNK);
		var fd = DOC.createDocumentFragment(),
			fd2 = DOC.createDocumentFragment(),
			g = S.view == 'grid';

		for (; n < lim; n++) {
			var it = S.vis[n],
				el = g ? card(it, n) : row(it, n);
			if (g && it.dir && S.dfirst)
				fd2.appendChild(el);
			else
				fd.appendChild(el);
		}
		if (g) {
			var gd = QS('#pane .gd');
			if (gd) gd.appendChild(fd2);
			QS('#pane .gf').appendChild(fd);
		}
		else
			QS('#pane .lbody').appendChild(fd);

		if (n < S.vis.length)
			rtimer = setTimeout(more, 16);
		else
			paint_sel();
	}
	more();
	paint_sel();
}

function row(it, i) {
	var sp = S.route[0] == '!',
		el = h('div.row' + (it.dir ? '.dir' : ''), { 'data-i': i, role: 'row' },
			h('div.nm', fico(it), h('span.t', { title: it.name }, it.name || '/')),
			sp ? h('div.m', { title: udec(it.path) }, udec(pparent(it.path))) : h('div.m', hdate(it.ts)),
			h('div.s', it.dir ? '—' : hsize(it.sz)),
			starbtn(it));
	return el;
}

function card(it, i) {
	var th = null;
	if (!it.dir) {
		th = h('div.th');
		if (has_thumb(it)) {
			var img = h('img', {
				loading: 'lazy',
				alt: '',
				src: SR + it.path + (it.q ? it.q + '&' : '?') + 'th=w&cache=i'
			});
			img.onerror = function () {
				clr(th).appendChild(fico(it));
			};
			th.appendChild(img);
		}
		else
			th.appendChild(fico(it));
	}
	var el = h('div.card' + (it.dir ? '.dir' : ''), { 'data-i': i },
		h('div.cn', fico(it), h('span.t', { title: it.name }, it.name), starbtn(it)),
		th);
	return el;
}

function starbtn(it) {
	var on = is_star(it);
	return h('button.star' + (on ? '.on' : ''), {
		title: on ? 'unstar' : 'star',
		html: svg(on ? 'star' : 'staro'),
		onclick: function (e) {
			e.stopPropagation();
			var v = star_toggle(it);
			this.classList.toggle('on', v);
			this.innerHTML = svg(v ? 'star' : 'staro');
			this.title = v ? 'unstar' : 'star';
			if (S.route == '!starred')
				show_special('!starred');
		}
	});
}

function render_err() {
	var e = S.err;
	if ((e.status == 403 || e.status == 404 || e.status == 401) && DRV.acct == '*')
		return empty('lock', 'Sign in to see this folder', 'it either needs an account, or does not exist',
			h('button.btn.acc', { onclick: show_login }, 'Sign in'));
	if (e.status == 404)
		return empty('empty', 'Folder not found', 'it may have been moved or deleted, or you lack access',
			h('button.btn', { onclick: function () { go('/'); } }, 'Go home'));
	if (e.status == 403)
		return empty('lock', 'No access', e.message);
	return empty('warn', 'Could not load this folder', e.message,
		h('button.btn', { onclick: function () { show_dir(S.path, true); } }, 'Retry'));
}

//
// views
//

var navseq = 0;

function show_dir(p, force) {
	var first = S.route !== p,
		seq = ++navseq;

	S.route = S.path = p;
	if (first) {
		S.sel = {};
		S.cur = S.anchor = -1;
		S.filter = '';
		ebi('filter').value = '';
	}
	render_crumbs();
	render_places();
	tree_mark();

	var c = CACHE[p];
	if (c && first) {
		take(c.js, p);
		render_pane();
		ebi('pane').scrollTop = 0;
	}
	else if (first) {
		S.items = [];
		S.err = null;
		skel();
	}

	fetch_ls(p, true).then(function (r) {
		if (seq != navseq)
			return;
		var had_err = !!S.err;
		S.err = null;
		if (r.changed || first && !c || had_err) {
			var st = ebi('pane').scrollTop;
			take(r.js, p);
			render_pane();
			if (!first || c)
				ebi('pane').scrollTop = st;
		}
		if (first)
			recent_add({ path: p, name: pname(p) || 'Home', dir: true, ts: 0 });
		do_want_sel();
	}, function (ex) {
		if (seq != navseq)
			return;
		S.err = ex;
		S.items = [];
		S.ls = null;
		S.perms = [];
		render_pane();
		render_tools();
	});
}

function take(js, p) {
	S.ls = js;
	S.perms = js.perms || [];
	S.items = items_from(p, js);
	S.err = null;
	if (js.srvinf)
		S.srv = strip_html((js.srvinf + '').split('</span>')[0]);
	if (js.acct && js.acct != DRV.acct) {
		// session changed under us (login/logout in another tab)
		DRV.acct = js.acct;
		render_acct();
	}
	render_tools();
	render_details();
}

function do_want_sel() {
	if (!want_sel)
		return;
	for (var a = 0; a < S.vis.length; a++)
		if (S.vis[a].path == want_sel || S.vis[a].path == want_sel + '/') {
			S.sel = {};
			S.sel[S.vis[a].path] = 1;
			S.cur = S.anchor = a;
			paint_sel(true);
			break;
		}
	want_sel = null;
}

function show_special(r) {
	navseq++;
	S.route = r;
	S.path = '/';
	S.err = null;
	S.ls = null;
	S.perms = [];
	S.sel = {};
	S.cur = S.anchor = -1;
	if (r == '!recent')
		S.items = sread('recent', []);
	else if (r == '!starred') {
		var st = stars();
		S.items = Object.keys(st).map(function (k) {
			return st[k];
		});
	}
	else
		return go('/');

	render_crumbs();
	render_places();
	render_tools();
	tree_mark();
	render_pane();
	render_details();
}

//
// selection + focus
//

function sel_list() {
	return S.vis.filter(function (it) {
		return S.sel[it.path];
	});
}

function paint_sel(scroll) {
	QSA('#pane [data-i]').forEach(function (el) {
		var i = +el.getAttribute('data-i'),
			it = S.vis[i];
		el.classList.toggle('sel', !!(it && S.sel[it.path]));
		el.classList.toggle('cur', i == S.cur);
	});
	if (scroll && S.cur >= 0) {
		var el = QS('#pane [data-i="' + S.cur + '"]');
		if (el && el.scrollIntoView)
			el.scrollIntoView({ block: 'nearest' });
	}
	render_details();
}

function click_item(i, e) {
	var it = S.vis[i];
	if (!it)
		return;

	if (e.shiftKey && S.anchor >= 0) {
		if (!(e.ctrlKey || e.metaKey))
			S.sel = {};
		var a = Math.min(S.anchor, i), b = Math.max(S.anchor, i);
		for (; a <= b; a++)
			S.sel[S.vis[a].path] = 1;
	}
	else if (e.ctrlKey || e.metaKey) {
		if (S.sel[it.path])
			delete S.sel[it.path];
		else
			S.sel[it.path] = 1;
		S.anchor = i;
	}
	else {
		S.sel = {};
		S.sel[it.path] = 1;
		S.anchor = i;
	}
	S.cur = i;
	paint_sel();
}

function open_item(it) {
	if (!it)
		return;
	if (it.dir)
		return go(it.path);

	recent_add(it);
	// M5 brings an in-app lightbox; for now let the browser render it
	WIN.open(SR + it.path + (it.q || ''), '_blank', 'noopener');
}

function move_cur(d) {
	if (!S.vis.length)
		return;
	var i = S.cur < 0 ? (d > 0 ? 0 : S.vis.length - 1) : Math.max(0, Math.min(S.vis.length - 1, S.cur + d));
	S.cur = S.anchor = i;
	S.sel = {};
	S.sel[S.vis[i].path] = 1;
	paint_sel(true);
}

function grid_cols() {
	var g = QS('#pane .gf'), el = g && g.firstChild;
	if (!el)
		return 1;
	return Math.max(1, Math.round(g.clientWidth / (el.offsetWidth + 14)));
}

//
// details panel
//

function render_details() {
	var d = ebi('details');
	if (d.hidden)
		return;

	clr(d);
	var sl = sel_list(),
		it = sl.length == 1 ? sl[0] : null;

	if (sl.length > 1) {
		var sz = 0, nd = 0;
		sl.forEach(function (x) {
			if (x.dir) nd++;
			else sz += x.sz || 0;
		});
		d.appendChild(h('h3', ico('info'), sl.length + ' items selected'));
		d.appendChild(h('dl',
			h('dt', 'Files'), h('dd', (sl.length - nd) + ', ' + hsize(sz)),
			nd ? [h('dt', 'Folders'), h('dd', nd + '')] : null));
		return;
	}
	if (!it) {
		var nm = S.route[0] == '!' ? (S.route == '!recent' ? 'Recent' : 'Starred') : (pname(S.path) || 'Home');
		d.appendChild(h('h3', ico('folder'), nm));
		d.appendChild(h('div.prev', h('span.fi', { html: svg('folder'), style: { '--c': 'var(--fg3)' } })));
		var dl = h('dl');
		if (S.route[0] != '!') {
			dl.appendChild(h('dt', 'Location'));
			dl.appendChild(h('dd', udec(S.path)));
			dl.appendChild(h('dt', 'Your access'));
			dl.appendChild(h('dd', S.perms.length ? S.perms.join(', ') : (S.err ? '—' : 'list only')));
		}
		dl.appendChild(h('dt', 'Tip'));
		dl.appendChild(h('dd', 'select a file to see its details'));
		d.appendChild(dl);
		return;
	}

	d.appendChild(h('h3', fico(it), it.name));

	var pv = h('div.prev');
	if (has_thumb(it)) {
		var img = h('img', { alt: '', src: SR + it.path + (it.q ? it.q + '&' : '?') + 'th=w&cache=i' });
		img.onerror = function () {
			clr(pv).appendChild(fico(it));
		};
		pv.appendChild(img);
	}
	else
		pv.appendChild(fico(it));
	d.appendChild(pv);

	var dl = h('dl'),
		k = kind(it);
	function kv(a, b) {
		if (b === undefined || b === null || b === '')
			return;
		dl.appendChild(h('dt', a));
		dl.appendChild(h('dd', b + ''));
	}
	kv('Type', it.dir ? 'Folder' : (it.ext ? it.ext.toUpperCase() + ' ' : '') + ({ img: 'image', vid: 'video', aud: 'audio', pdf: 'document', doc: 'document', sheet: 'spreadsheet', arc: 'archive', code: 'code' }[k] || 'file'));
	if (!it.dir)
		kv('Size', hsize(it.sz) + (it.sz >= 1024 ? ' (' + it.sz.toLocaleString() + ' bytes)' : ''));
	kv('Modified', it.ts ? hdate(it.ts, true) : '');
	kv('Location', udec(pparent(it.path)));

	var tg = it.tags || {};
	var TN = { res: 'Resolution', '.dur': 'Duration', '.fps': 'Framerate', vc: 'Video codec', ac: 'Audio codec', artist: 'Artist', title: 'Title', album: 'Album', '.bpm': 'BPM', key: 'Key', '.q': 'Bitrate', '.files': 'Files' };
	Object.keys(tg).forEach(function (t) {
		var v = tg[t];
		if (v === '' || v === null || v === undefined || t == 'fmt')
			return;
		if (k == 'img' && (t == 'vc' || t == '.fps'))
			return;  // ffprobe calls jpegs "mjpeg video at 25 fps"; not useful
		if (t == '.dur')
			v = hdur(+v);
		else if (t == '.q')
			v = v + ' kbps';
		kv(TN[t] || t.replace(/^\./, ''), v);
	});
	d.appendChild(dl);

	var url = SR + it.path + (it.q || '');
	d.appendChild(h('div.acts',
		h('button.btn', { onclick: function () { open_item(it); } }, it.dir ? 'Open' : 'Open'),
		it.dir ? null : h('a.btn', { href: url, download: it.name }, 'Download'),
		h('button.btn', { onclick: function () { copy_link(it); } }, 'Copy link')
	));
}

function copy_link(it) {
	var url = location.origin + SR + it.path + (it.q || '');
	var done = function () {
		var pub = S.ls && S.ls.cfg && /fk/.test(it.q || '') ? ' (includes a filekey)' : '';
		toast('Link copied' + pub + '\nworks for anyone with read-access to this path');
	};
	if (navigator.clipboard && WIN.isSecureContext)
		navigator.clipboard.writeText(url).then(done, function () {
			prompt_copy(url);
		});
	else
		prompt_copy(url);
}
function prompt_copy(url) {
	var ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
	ta.value = url;
	DOC.body.appendChild(ta);
	ta.select();
	var ok = false;
	try {
		ok = DOC.execCommand('copy');
	}
	catch (ex) { }
	DOC.body.removeChild(ta);
	if (ok)
		toast('Link copied');
	else
		WIN.prompt('copy this link:', url);
}

//
// volume tree (lazy)
//

var TREE = {};  // path -> {el, open, loaded}

function tree_init() {
	var t = clr(ebi('tree'));
	TREE = {};
	tree_fill(t, '/', 0);
}

function tree_fill(box, p, depth) {
	fetch_ls(p).then(function (r) {
		var dirs = items_from(p, r.js).filter(function (x) {
			return x.dir;
		});
		dirs = (coll ? dirs.sort(function (a, b) { return coll.compare(a.name, b.name); }) : dirs);
		clr(box);
		if (!dirs.length && depth == 0)
			box.appendChild(h('div.hint', { style: { padding: '0 12px' } }, DRV.acct == '*' ? 'sign in to see more' : 'no folders'));
		dirs.forEach(function (it) {
			box.appendChild(tree_node(it, depth));
		});
		var n = TREE[p];
		if (n) {
			n.loaded = true;
			n.wrap.classList.toggle('leaf', !dirs.length);
		}
		tree_mark();
	}, function () {
		clr(box);
		var n = TREE[p];
		if (n) {
			n.loaded = true;
			n.wrap.classList.add('leaf');
		}
	});
}

function tree_node(it, depth) {
	var kids = h('div.kids', { hidden: true }),
		tw = h('span.tw', { html: svg('chev') }),
		a = h('a', { href: '#' + it.path, title: it.name, style: { '--d': depth } }, tw, ico('folder'), h('span.n', it.name)),
		wrap = h('div.tn', { role: 'treeitem' }, a, kids),
		node = { el: a, wrap: wrap, kids: kids, open: false, loaded: false, depth: depth, path: it.path };

	TREE[it.path] = node;
	tw.addEventListener('click', function (e) {
		e.preventDefault();
		e.stopPropagation();
		tree_toggle(node);
	});
	return wrap;
}

function tree_toggle(n, force) {
	n.open = force === undefined ? !n.open : force;
	n.wrap.classList.toggle('open', n.open);
	n.kids.hidden = !n.open;
	if (n.open && !n.loaded)
		tree_fill(n.kids, n.path, n.depth + 1);
}

function tree_mark() {
	var p = S.route && S.route[0] != '!' ? S.path : null;
	for (var k in TREE)
		TREE[k].el.classList.toggle('on', k == p);

	if (!p)
		return;

	// expand ancestors so the current folder is visible
	var acc = '/', parts = p.split('/').filter(Boolean);
	for (var a = 0; a < parts.length - 1; a++) {
		acc += parts[a] + '/';
		var n = TREE[acc];
		if (n && !n.open)
			tree_toggle(n, true);
	}
}

//
// toasts + sheets
//

function toast(msg, o) {
	o = o || {};
	var el = h('div.toast' + (o.err ? '.err' : ''), h('span', msg),
		o.act ? h('button', {
			onclick: function () {
				o.act[1]();
				kill();
			}
		}, o.act[0]) : null);
	function kill() {
		if (el.parentNode)
			el.parentNode.removeChild(el);
	}
	ebi('toasts').appendChild(el);
	setTimeout(kill, o.ms || (o.err ? 8000 : 4000));
	return kill;
}

function sheet(title, body, btns, onsubmit) {
	var sh = clr(ebi('sheet')),
		f = h('form.dlg', {
			onsubmit: function (e) {
				if (!onsubmit || !onsubmit(e, f))
					e.preventDefault();
			}
		}, h('h2', title), body, h('div.row2', btns));
	sh.appendChild(f);
	sh.hidden = false;
	sh.onclick = function (e) {
		if (e.target === sh)
			close_sheet();
	};
	var inp = QS('input:not([type=hidden])', f);
	if (inp)
		setTimeout(function () { inp.focus(); inp.select && inp.select(); }, 30);
	return f;
}
function close_sheet() {
	ebi('sheet').hidden = true;
	clr(ebi('sheet'));
}
function cancel_btn() {
	return h('button.btn', { type: 'button', onclick: close_sheet }, 'Cancel');
}

function show_login() {
	if (!DRV.have_pw && DRV.idp_login) {
		location.href = DRV.idp_login;
		return;
	}
	// the server's multipart parser wants "act" as the very first field
	var body = h('div',
		h('input', { type: 'hidden', name: 'act', value: 'login' }),
		DRV.usernames ? [h('label.f', { for: 'l_u' }, 'Username'), h('input#l_u', { type: 'text', name: 'uname', autocomplete: 'username' })] : null,
		h('label.f', { for: 'l_p' }, 'Password'),
		h('input#l_p', { type: 'password', name: 'cppwd', autocomplete: 'current-password' }),
		h('input', { type: 'hidden', name: 'uhash', value: location.hash || '-' }),
		DRV.idp_login ? h('div.hint', 'or ', h('a', { href: DRV.idp_login, style: { 'text-decoration': 'underline' } }, 'sign in with SSO')) : null
	);
	var f = sheet('Sign in', body, [cancel_btn(), h('button.btn.acc', { type: 'submit' }, 'Sign in')], function () {
		// let the browser do a real form post; the server replies with a redirect back here
		return true;
	});
	f.setAttribute('method', 'post');
	f.setAttribute('enctype', 'multipart/form-data');
	f.setAttribute('action', SR + '/?drive');
}

function show_acct() {
	close_menus();
	var m = h('div.menu#acctmenu', { style: { right: '12px', top: '56px', position: 'fixed' } },
		h('div', { style: { padding: '8px 16px', color: 'var(--fg2)', 'font-size': '13px' } }, 'signed in as ', h('b', DRV.acct)),
		h('button', { onclick: logout }, ico('back'), 'Sign out'),
		h('button', { onclick: function () { location.href = SR + '/?h'; } }, ico('cog'), 'Control panel'));
	DOC.body.appendChild(m);
}

function logout() {
	close_menus();
	if (DRV.idp_logout) {
		location.href = DRV.idp_logout;
		return;
	}
	fetch(SR + '/?pw=x', { credentials: 'same-origin' }).then(function () {
		location.reload();
	}, function () {
		location.href = SR + '/?pw=x';
	});
}

function close_menus() {
	ebi('newmenu').hidden = true;
	var m = ebi('acctmenu');
	if (m)
		m.parentNode.removeChild(m);
}

//
// settings: theme / accent / density
//

var ACCENTS = [
	['blue', '#1a73e8', '#fff'],
	['trumpet gold', '#e8a400', '#1f1600'],
	['green', '#188038', '#fff'],
	['violet', '#8b3ffd', '#fff'],
	['pink', '#d81b60', '#fff'],
	['teal', '#00897b', '#fff']
];

function hex2rgba(hx, a) {
	var n = parseInt(hx.slice(1), 16);
	return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}

var mq_dark = WIN.matchMedia ? WIN.matchMedia('(prefers-color-scheme: dark)') : null;

function apply_look() {
	var th = sread('theme', 'auto'),
		dark = th == 'dark' || (th == 'auto' && mq_dark && mq_dark.matches),
		acc = ACCENTS[sread('accent', 0)] || ACCENTS[0];

	HTM.classList.toggle('dark', dark);
	HTM.classList.toggle('compact', sread('density', 'comfy') == 'compact');
	HTM.style.setProperty('--acc', acc[1]);
	HTM.style.setProperty('--acc-fg', acc[2]);
	HTM.style.setProperty('--sel', hex2rgba(acc[1], dark ? .24 : .14));
}
if (mq_dark && mq_dark.addEventListener)
	mq_dark.addEventListener('change', apply_look);

function seg(key, dv, opts) {
	var v = sread(key, dv);
	return h('div.seg', opts.map(function (o) {
		return h('button' + (o[0] == v ? '.on' : ''), {
			type: 'button',
			onclick: function () {
				swrite(key, o[0]);
				QSA('button', this.parentNode).forEach(function (b) { b.classList.remove('on'); });
				this.classList.add('on');
				apply_look();
				if (key == 'dfirst') {
					S.dfirst = o[0];
					render_pane();
				}
			}
		}, o[1]);
	}));
}

function show_cfg() {
	var acc = sread('accent', 0);
	var body = h('div',
		h('label.f', 'Theme'), seg('theme', 'auto', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]),
		h('label.f', 'Accent'), h('div.seg', ACCENTS.map(function (a, i) {
			return h('button.sw' + (i == acc ? '.on' : ''), {
				type: 'button', title: a[0], style: { '--c': a[1] },
				onclick: function () {
					swrite('accent', i);
					QSA('.sw', this.parentNode).forEach(function (b) { b.classList.remove('on'); });
					this.classList.add('on');
					apply_look();
				}
			});
		})),
		h('label.f', 'Density'), seg('density', 'comfy', [['comfy', 'Comfortable'], ['compact', 'Compact']]),
		h('label.f', 'Folders'), seg('dfirst', true, [[true, 'Folders first'], [false, 'Mixed with files']]),
		h('label.f', 'Keyboard'),
		h('div.hint', { style: { 'line-height': '2' } },
			h('kbd', 'J'), ' ', h('kbd', 'K'), ' / arrows move · ', h('kbd', 'Enter'), ' open · ', h('kbd', 'Backspace'), ' up a folder · ',
			h('kbd', 'G'), ' grid/list · ', h('kbd', 'I'), ' details · ', h('kbd', '/'), ' filter · ', h('kbd', 'Ctrl'), '+', h('kbd', 'A'), ' select all · ',
			h('kbd', 'Esc'), ' clear'),
		h('div.hint', { style: { 'margin-top': '14px' } }, 'drive-ui is experimental; ', h('a', { href: SR + '/', style: { 'text-decoration': 'underline' } }, 'the classic UI'), ' has every feature')
	);
	sheet('Settings', body, [h('button.btn.acc', { type: 'button', onclick: close_sheet }, 'Done')]);
}

//
// new folder (optimistic)
//

function show_mkdir() {
	close_menus();
	if (S.route[0] == '!' || !can('write'))
		return toast('you cannot create folders here', { err: true });

	var inp = h('input', { type: 'text', value: 'Untitled folder' }),
		f = sheet('New folder', inp, [cancel_btn(), h('button.btn.acc', { type: 'submit' }, 'Create')], function () {
			var nm = inp.value.trim();
			close_sheet();
			if (nm)
				mkdir(nm);
			return false;
		});
}

function mkdir(nm) {
	var p = S.path,
		it = { path: p + uenc(nm) + '/', q: '', name: nm, dir: true, sz: 0, ts: Date.now() / 1000, ext: '', tags: {} };

	if (S.items.some(function (x) { return x.path == it.path; }))
		return toast('"' + nm + '" already exists', { err: true });

	S.items.push(it);
	S.sel = {};
	S.sel[it.path] = 1;
	render_pane();
	S.cur = S.vis.indexOf(it);
	paint_sel(true);

	var fd = new FormData();
	fd.append('act', 'mkdir');
	fd.append('name', nm);
	fetch(SR + p, { method: 'POST', body: fd, credentials: 'same-origin', redirect: 'manual' }).then(function (r) {
		if (!(r.ok || r.status == 201 || r.type == 'opaqueredirect'))
			return r.text().then(function (t) {
				throw new Error(strip_html(t) || ('error ' + r.status));
			});
		delete CACHE[p];
		if (TREE[p])
			TREE[p].loaded = false;
		refresh_soon(p);
	}).catch(function (ex) {
		// roll back
		S.items = S.items.filter(function (x) { return x !== it; });
		if (S.path == p)
			render_pane();
		toast('could not create folder: ' + ex.message, { err: true });
	});
}

var rs_timer = {};
function refresh_soon(p) {
	clearTimeout(rs_timer[p]);
	rs_timer[p] = setTimeout(function () {
		delete CACHE[p];
		if (S.route == p)
			show_dir(p, true);
		var n = TREE[p] || (p == '/' ? null : null);
		if (n && n.open)
			tree_fill(n.kids, p, n.depth + 1);
		else if (n)
			n.loaded = false;
	}, 400);
}

//
// marquee selection
//

function marquee_init() {
	var pane = ebi('pane'), box = null, x0, y0, base = null, moved = false;

	pane.addEventListener('mousedown', function (e) {
		if (e.button !== 0 || e.target.closest('[data-i], .lhead, button, a, .empty'))
			return;
		var r = pane.getBoundingClientRect();
		x0 = e.clientX - r.left + pane.scrollLeft;
		y0 = e.clientY - r.top + pane.scrollTop;
		base = (e.ctrlKey || e.metaKey || e.shiftKey) ? Object.assign({}, S.sel) : {};
		moved = false;
		box = h('div#marq');
		pane.appendChild(box);
		e.preventDefault();
		pane.focus();
	});
	WIN.addEventListener('mousemove', function (e) {
		if (!box)
			return;
		var r = pane.getBoundingClientRect(),
			x1 = e.clientX - r.left + pane.scrollLeft,
			y1 = e.clientY - r.top + pane.scrollTop,
			L = Math.min(x0, x1), T = Math.min(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0);

		if (W + H > 4)
			moved = true;
		box.style.left = L + 'px';
		box.style.top = T + 'px';
		box.style.width = W + 'px';
		box.style.height = H + 'px';

		var sel = Object.assign({}, base);
		QSA('#pane [data-i]').forEach(function (el) {
			var er = el.getBoundingClientRect(),
				eL = er.left - r.left + pane.scrollLeft,
				eT = er.top - r.top + pane.scrollTop;
			if (eL < L + W && eL + er.width > L && eT < T + H && eT + er.height > T)
				sel[S.vis[+el.getAttribute('data-i')].path] = 1;
		});
		S.sel = sel;
		paint_sel();
	});
	WIN.addEventListener('mouseup', function () {
		if (!box)
			return;
		box.parentNode && box.parentNode.removeChild(box);
		box = null;
		if (!moved) {
			S.sel = base || {};
			S.cur = -1;
			paint_sel();
		}
	});
}

//
// up2k uploader (wire-compatible with up2k.js / u2c.py)
//

var U = {
	tasks: [],
	chunks: [],      // pending [task, idx]
	nconn: 0,
	maxconn: 4,
	hashing: 0,
	paused: false,
	nid: 0,
	sent: [],        // [t, bytes] samples for speed
	min: false,
	el: null
},
	sha_impl = null;

function get_chunksize(filesize) {
	// must match up2k.js and up2k.py exactly
	var chunksize = 1024 * 1024,
		stepsize = 512 * 1024;

	while (true) {
		for (var mul = 1; mul <= 2; mul++) {
			var nchunks = Math.ceil(filesize / chunksize);
			if (nchunks <= 256 || (chunksize >= 32 * 1024 * 1024 && nchunks <= 4096))
				return chunksize;

			chunksize += stepsize;
			stepsize *= mul;
		}
	}
}

function b64u(u8) {
	var cs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
		ret = '';
	for (var a = 0; a + 2 < u8.length; a += 3) {
		var n = (u8[a] << 16) | (u8[a + 1] << 8) | u8[a + 2];
		ret += cs[(n >> 18) & 63] + cs[(n >> 12) & 63] + cs[(n >> 6) & 63] + cs[n & 63];
	}
	return ret;  // input is always 33 bytes, so no padding
}

function load_sha() {
	if (sha_impl)
		return sha_impl;

	var sub = WIN.crypto && WIN.crypto.subtle;
	if (sub && WIN.isSecureContext !== false)
		return sha_impl = Promise.resolve(function (buf) {
			return sub.digest('SHA-512', buf).then(function (r) {
				return new Uint8Array(r);
			});
		});

	// plain-http on a lan ip; borrow the asmcrypto fallback that up2k.js uses
	return sha_impl = new Promise(function (ok, ng) {
		var s = DOC.createElement('script');
		s.nonce = JS_NONCE;
		s.src = SR + '/.cpr/w/deps/sha512.ac.js?_=' + TS;
		s.onload = function () {
			if (!WIN.asmCrypto)
				return ng(new Error('sha512 fallback did not load'));
			ok(function (buf) {
				var hs = new asmCrypto.Sha512();
				hs.process(new Uint8Array(buf));
				hs.finish();
				return Promise.resolve(hs.result);
			});
		};
		s.onerror = function () {
			ng(new Error('could not load sha512 fallback'));
		};
		DOC.head.appendChild(s);
	});
}

function read_blob(b) {
	if (b.arrayBuffer)
		return b.arrayBuffer();
	return new Promise(function (ok, ng) {
		var fr = new FileReader();
		fr.onload = function () { ok(fr.result); };
		fr.onerror = function () { ng(fr.error); };
		fr.readAsArrayBuffer(b);
	});
}

// files: [{file, rel}] where rel is the raw (unencoded) subfolder path ending with / or ''
function enqueue(files, dst) {
	if (!files.length)
		return;

	files.forEach(function (f) {
		var t = {
			id: ++U.nid,
			file: f.file,
			name: f.file.name,
			size: f.file.size,
			lmod: Math.floor((f.file.lastModified || Date.now()) / 1000),
			dst: dst,
			purl: SR + dst + penc(f.rel || ''),
			rel: f.rel || '',
			st: 'queued',
			hash: [],
			hashed: 0,
			missing: [],
			inflight: {},
			done_b: 0,       // bytes confirmed uploaded
			live: {},        // idx -> bytes sent so far for in-flight chunks
			skipped: 0,
			nhs: 0,
			tries: 0,
			msg: ''
		};
		U.tasks.push(t);
	});
	U.min = false;
	tray_render();
	pump();
}

function pump() {
	if (U.paused)
		return tray_soon();

	// hash up to two files at a time; small files hash instantly so keep it moving
	for (var a = 0; a < U.tasks.length && U.hashing < 2; a++) {
		var t = U.tasks[a];
		if (t.st == 'queued')
			hash_task(t);
	}

	while (U.nconn < U.maxconn && U.chunks.length) {
		var c = U.chunks.shift();
		if (c[0].st != 'up')
			continue;
		send_chunk(c[0], c[1]);
	}
	tray_soon();
}

function hash_task(t) {
	t.st = 'hashing';
	U.hashing++;

	var csz = get_chunksize(t.size),
		n = Math.ceil(t.size / csz),
		i = 0;

	load_sha().then(function (sha) {
		function next() {
			if (t.st != 'hashing')
				return fin();  // cancelled
			if (i >= n)
				return fin(true);

			var car = i * csz,
				cdr = Math.min(t.size, car + csz);
			read_blob(t.file.slice(car, cdr)).then(sha).then(function (dig) {
				t.hash.push(b64u(dig.subarray(0, 33)));
				t.hashed = cdr;
				i++;
				tray_soon();
				next();
			}, function (ex) {
				fail(t, 'could not read file: ' + (ex && ex.message || ex));
				fin();
			});
		}
		next();
	}, function (ex) {
		fail(t, ex.message);
		fin();
	});

	function fin(ok) {
		U.hashing--;
		if (ok) {
			t.st = 'hs';
			handshake(t);
		}
		pump();
	}
}

function handshake(t) {
	var req = {
		name: t.name,
		size: t.size,
		lmod: t.lmod,
		hash: t.hash
	};
	t.st = 'hs';
	t.nhs++;
	tray_soon();

	fetch(t.purl, {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'Content-Type': 'text/plain' },
		body: JSON.stringify(req)
	}).then(function (r) {
		return r.text().then(function (txt) {
			if (!r.ok) {
				var e = new Error(strip_html(txt) || ('error ' + r.status));
				e.status = r.status;
				throw e;
			}
			return JSON.parse(txt);
		});
	}).then(function (rsp) {
		if (t.st == 'cancel')
			return;

		t.tries = 0;
		if (rsp.purl)
			t.purl = SR + penc(rsp.purl);
		if (rsp.name && rsp.name != t.name) {
			t.msg = 'saved as ' + rsp.name;
			t.name = rsp.name;
		}
		t.wark = rsp.wark;
		t.sprs = rsp.sprs;

		var csz = get_chunksize(t.size),
			miss = rsp.hash || [];

		if (t.nhs == 1) {
			var mb = 0;
			miss.forEach(function (hh) {
				var ix = t.hash.indexOf(hh);
				mb += ix == t.hash.length - 1 ? (t.size - ix * csz) : csz;
			});
			t.skipped = Math.max(0, t.size - mb);
		}

		if (!miss.length) {
			t.st = 'done';
			t.done_b = t.size;
			t.file = null;
			on_done(t);
			return pump();
		}

		t.st = 'up';
		t.missing = [];
		t.done_b = t.size;
		miss.forEach(function (hh) {
			var ix = t.hash.indexOf(hh);
			if (ix < 0)
				return;
			if (t.missing.indexOf(ix) < 0) {
				t.missing.push(ix);
				t.done_b -= ix == t.hash.length - 1 ? (t.size - ix * csz) : csz;
				U.chunks.push([t, ix]);
			}
		});
		pump();
	}).catch(function (ex) {
		if (t.st == 'cancel')
			return;
		if (ex.status && ex.status < 500 && ex.status != 408 && ex.status != 429)
			return fail(t, ex.message);
		retry(t, ex, function () {
			handshake(t);
		});
	});
}

function send_chunk(t, ix) {
	var csz = get_chunksize(t.size),
		car = ix * csz,
		cdr = Math.min(t.size, car + csz),
		xhr = new XMLHttpRequest();

	U.nconn++;
	t.inflight[ix] = xhr;
	t.live[ix] = 0;

	xhr.upload.onprogress = function (e) {
		var d = e.loaded - (t.live[ix] || 0);
		t.live[ix] = e.loaded;
		U.sent.push([Date.now(), d]);
		tray_soon();
	};
	function end() {
		U.nconn--;
		delete t.inflight[ix];
		delete t.live[ix];
	}
	xhr.onload = function () {
		end();
		if (t.st == 'cancel')
			return pump();

		if (xhr.status == 200) {
			t.tries = 0;
			t.done_b += cdr - car;
			t.missing = t.missing.filter(function (x) { return x != ix; });
			if (!t.missing.length && !Object.keys(t.inflight).length && t.st == 'up') {
				// all chunks sent; confirm with a final handshake
				handshake(t);
			}
			return pump();
		}

		var txt = strip_html(xhr.responseText);
		if (txt.indexOf('unknown wark') + 1 || txt.indexOf('already got that') + 1) {
			// server forgot the upload, or got the chunk from a parallel client; re-sync via handshake
			t.missing = t.missing.filter(function (x) { return x != ix; });
			if (!Object.keys(t.inflight).length && t.st == 'up') {
				U.chunks = U.chunks.filter(function (c) { return c[0] !== t; });
				handshake(t);
			}
			return pump();
		}
		if (xhr.status >= 400 && xhr.status < 500 && xhr.status != 408 && xhr.status != 429) {
			fail(t, txt || ('error ' + xhr.status));
			return pump();
		}
		retry(t, new Error(txt || ('error ' + xhr.status)), function () {
			U.chunks.unshift([t, ix]);
			pump();
		});
		pump();
	};
	xhr.onerror = xhr.ontimeout = function () {
		end();
		if (t.st == 'cancel')
			return pump();
		retry(t, new Error('network error'), function () {
			U.chunks.unshift([t, ix]);
			pump();
		});
		pump();
	};
	xhr.onabort = function () {
		end();
		pump();
	};

	xhr.open('POST', t.purl, true);
	xhr.setRequestHeader('X-Up2k-Hash', t.hash[ix]);
	xhr.setRequestHeader('X-Up2k-Wark', t.wark);
	xhr.setRequestHeader('Content-Type', 'application/octet-stream');
	xhr.send(t.file.slice(car, cdr));
}

function retry(t, ex, fn) {
	t.tries++;
	if (t.tries > 12)
		return fail(t, ex.message + ' (gave up after ' + (t.tries - 1) + ' retries)');

	var wait = Math.min(30, Math.pow(2, Math.min(t.tries, 5))) * 1000;
	t.msg = ex.message + '; retrying in ' + (wait / 1000) + 's';
	if (!navigator.onLine)
		t.msg = 'offline; will resume when the network is back';
	tray_soon();

	var go_ = function () {
		WIN.removeEventListener('online', go_);
		clearTimeout(tm);
		if (t.st == 'cancel' || t.st == 'err')
			return;
		t.msg = '';
		fn();
	};
	var tm = setTimeout(go_, wait);
	WIN.addEventListener('online', go_);
}

function fail(t, msg) {
	t.st = 'err';
	t.msg = msg;
	for (var k in t.inflight)
		try { t.inflight[k].abort(); } catch (ex) { }
	U.chunks = U.chunks.filter(function (c) { return c[0] !== t; });
	tray_soon();
}

function cancel(t) {
	if (t.st == 'done')
		return;
	t.st = 'cancel';
	t.msg = 'cancelled';
	for (var k in t.inflight)
		try { t.inflight[k].abort(); } catch (ex) { }
	U.chunks = U.chunks.filter(function (c) { return c[0] !== t; });
	t.file = t.file;  // kept so "retry" can restart it
	tray_render();
	pump();
}

function restart(t) {
	if (!t.file)
		return;
	t.st = 'queued';
	t.hash = [];
	t.hashed = 0;
	t.nhs = 0;
	t.tries = 0;
	t.msg = '';
	t.missing = [];
	t.done_b = 0;
	t.live = {};
	t.purl = SR + t.dst + penc(t.rel);
	tray_render();
	pump();
}

function on_done(t) {
	var dir = t.dst + penc(t.rel);
	delete CACHE[dir];
	// refresh the folder we're in if the upload landed in it (or created a subfolder of it)
	if (S.route && S.route[0] != '!' && dir.indexOf(S.path) === 0)
		refresh_soon(S.path);
}

function busy() {
	return U.tasks.some(function (t) {
		return t.st == 'queued' || t.st == 'hashing' || t.st == 'hs' || t.st == 'up';
	});
}

//
// upload tray
//

var tray_tm = null;
function tray_soon() {
	if (!tray_tm)
		tray_tm = setTimeout(function () {
			tray_tm = null;
			tray_update();
		}, 150);
}

function stats() {
	var tot = 0, done = 0, n = { ok: 0, ng: 0, act: 0, dd: 0, q: 0 }, hb = 0;
	U.tasks.forEach(function (t) {
		if (t.st == 'cancel')
			return;
		tot += t.size;
		var live = 0;
		for (var k in t.live) live += t.live[k];
		done += t.st == 'done' ? t.size : Math.min(t.size, t.done_b + live);
		if (t.st == 'done') {
			n.ok++;
			if (t.skipped && t.skipped >= t.size && t.size)
				n.dd++;
		}
		else if (t.st == 'err')
			n.ng++;
		else {
			n.act++;
			if (t.st == 'hashing' || t.st == 'queued')
				hb += t.size - t.hashed;
		}
	});

	var now = Date.now();
	U.sent = U.sent.filter(function (x) { return now - x[0] < 5000; });
	var spd = 0;
	if (U.sent.length) {
		var b = 0;
		U.sent.forEach(function (x) { b += x[1]; });
		spd = b / Math.max(1, (now - U.sent[0][0]) / 1000);
	}
	return { tot: tot, done: done, n: n, spd: spd };
}

function tray_render() {
	var tr = ebi('tray');
	clr(tr);
	if (!U.tasks.length) {
		tr.hidden = true;
		return;
	}
	tr.hidden = false;
	tr.classList.toggle('min', U.min);

	U.el = {
		title: h('b'),
		pz: h('button.ib', {
			title: 'pause / resume', onclick: function () {
				U.paused = !U.paused;
				tray_update();
				pump();
			}
		}),
		mn: h('button.ib', {
			title: 'minimize', onclick: function () {
				U.min = !U.min;
				tray_render();
			}
		}),
		cl: h('button.ib', { title: 'close', html: svg('x'), onclick: tray_close }),
		bar: h('i'),
		sub1: h('span'),
		sub2: h('span'),
		list: h('div.ul')
	};
	tr.appendChild(h('div.th', U.el.title, U.el.pz, U.el.mn, U.el.cl));
	tr.appendChild(h('div.bar0', U.el.bar));
	tr.appendChild(h('div.sub', U.el.sub1, U.el.sub2));
	tr.appendChild(U.el.list);

	U.tasks.forEach(function (t) {
		t.el = {
			st: h('div.st'),
			pb: h('i'),
			x: h('button.ib.x', { onclick: function () {
				if (t.st == 'err' || t.st == 'cancel')
					restart(t);
				else
					cancel(t);
			} }),
			icon: fico({ ext: (t.name.split('.').pop() || '').toLowerCase(), dir: false })
		};
		t.el.row = h('div.uf', t.el.icon, h('div.n', { title: udec(t.dst) + t.rel + t.name }, t.rel + t.name), t.el.x, h('div.pb', t.el.pb), t.el.st);
		U.el.list.appendChild(t.el.row);
	});
	tray_update();
}

function tray_update() {
	if (!U.el || ebi('tray').hidden)
		return;
	var s = stats(), n = s.n, act = busy();

	U.el.title.textContent = act ?
		(U.paused ? 'Paused · ' : 'Uploading ') + n.act + (n.act == 1 ? ' item' : ' items') :
		(n.ok + (n.ok == 1 ? ' upload' : ' uploads') + ' complete' + (n.ng ? ', ' + n.ng + ' failed' : ''));

	U.el.pz.innerHTML = svg(U.paused ? 'play' : 'pause');
	U.el.pz.hidden = !act;
	U.el.mn.innerHTML = svg(U.min ? 'chevu' : 'chevd');
	U.el.bar.style.width = (s.tot ? 100 * s.done / s.tot : 100).toFixed(1) + '%';

	var eta = s.spd > 0 ? (s.tot - s.done) / s.spd : -1;
	U.el.sub1.textContent = act ?
		hsize(s.done) + ' of ' + hsize(s.tot) + (s.spd > 1 ? ' · ' + hsize(s.spd) + '/s' : '') + (eta > 0 ? ' · ' + hdur(eta) + ' left' : '') :
		hsize(s.tot) + ' total';
	U.el.sub2.textContent = n.dd ? 'already had ' + n.dd + ' of these 🙂' : '';

	U.tasks.forEach(function (t) {
		if (!t.el)
			return;
		var live = 0;
		for (var k in t.live) live += t.live[k];
		var pct = t.st == 'done' ? 100 :
			t.st == 'hashing' ? (t.size ? 100 * t.hashed / t.size : 100) :
				(t.size ? 100 * Math.min(t.size, t.done_b + live) / t.size : 0),
			txt = '';

		switch (t.st) {
			case 'queued': txt = 'waiting'; break;
			case 'hashing': txt = 'checking · ' + pct.toFixed(0) + '%'; break;
			case 'hs': txt = t.nhs > 1 ? 'finishing' : 'asking server'; break;
			case 'up': txt = hsize(Math.min(t.size, t.done_b + live)) + ' of ' + hsize(t.size); break;
			case 'done':
				txt = t.skipped >= t.size && t.size ? 'already on server, skipped' :
					t.skipped ? 'done · ' + hsize(t.skipped) + ' deduped/resumed' : 'done · ' + hsize(t.size);
				break;
			case 'err': txt = 'failed: ' + t.msg; break;
			case 'cancel': txt = 'cancelled'; break;
		}
		if (t.msg && t.st != 'err' && t.st != 'cancel')
			txt += ' · ' + t.msg;

		var dd = t.st == 'done' && t.skipped >= t.size && t.size;
		t.el.st.textContent = txt;
		if (dd && !QS('.badge', t.el.st))
			t.el.st.appendChild(h('span.badge', 'dedup'));
		t.el.pb.style.width = pct.toFixed(1) + '%';
		t.el.row.classList.toggle('ok', t.st == 'done');
		t.el.row.classList.toggle('ng', t.st == 'err');
		var xi = t.st == 'done' ? 'ok' : (t.st == 'err' || t.st == 'cancel') ? 'retry' : 'x';
		if (t.el.x.getAttribute('data-i') != xi) {
			t.el.x.setAttribute('data-i', xi);
			t.el.x.innerHTML = svg(xi);
			t.el.x.title = xi == 'ok' ? 'done' : xi == 'retry' ? 'retry' : 'cancel';
			t.el.x.disabled = xi == 'ok';
		}
	});

	if (act)
		tray_soon();  // keep speed/eta fresh
}

function tray_close() {
	if (busy()) {
		if (!WIN.confirm('cancel all remaining uploads?'))
			return;
		U.tasks.forEach(cancel);
	}
	U.tasks = [];
	U.chunks = [];
	tray_render();
}

WIN.addEventListener('beforeunload', function (e) {
	if (busy()) {
		e.preventDefault();
		e.returnValue = 'uploads are still running';
		return e.returnValue;
	}
});
WIN.addEventListener('online', function () {
	pump();
});

//
// drag-drop / paste / pickers
//

function up_target(p) {
	p = p || (S.route && S.route[0] != '!' ? S.path : null);
	if (!p)
		return null;
	if (p == S.path && !can('write'))
		return null;
	return p;
}

function walk_entry(ent, rel, out) {
	return new Promise(function (ok) {
		if (ent.isFile) {
			ent.file(function (f) {
				out.push({ file: f, rel: rel });
				ok();
			}, function () { ok(); });
		}
		else if (ent.isDirectory) {
			var rd = ent.createReader(), all = [];
			var more = function () {
				rd.readEntries(function (ents) {
					if (!ents.length) {
						Promise.all(all.map(function (e) {
							return walk_entry(e, rel + ent.name + '/', out);
						})).then(ok);
						return;
					}
					all = all.concat(Array.prototype.slice.call(ents));
					more();
				}, function () { ok(); });
			};
			more();
		}
		else ok();
	});
}

function from_datatransfer(dt) {
	var items = dt.items && dt.items.length && dt.items[0].webkitGetAsEntry ? Array.prototype.slice.call(dt.items) : null;
	if (!items) {
		return Promise.resolve(Array.prototype.slice.call(dt.files || []).map(function (f) {
			return { file: f, rel: '' };
		}));
	}
	var ents = items.map(function (it) {
		return it.kind == 'file' ? it.webkitGetAsEntry() : null;
	}).filter(Boolean), out = [];

	if (!ents.length)
		// synthetic / exotic drops without filesystem entries; take the flat file list
		return Promise.resolve(Array.prototype.slice.call(dt.files || []).map(function (f) {
			return { file: f, rel: '' };
		}));

	return Promise.all(ents.map(function (e) {
		return walk_entry(e, '', out);
	})).then(function () {
		return out;
	});
}

function drag_init() {
	var dz = ebi('dropz'), depth = 0, over = null;

	function has_files(e) {
		var t = e.dataTransfer && e.dataTransfer.types;
		return t && Array.prototype.indexOf.call(t, 'Files') + 1;
	}
	function set_over(el) {
		if (over === el)
			return;
		if (over)
			over.classList.remove('dropok');
		over = el;
		if (over)
			over.classList.add('dropok');
		var it = over ? S.vis[+over.getAttribute('data-i')] : null,
			p = it ? it.path : up_target();
		ebi('dropto').textContent = p ? 'to ' + (pname(p) || 'Home') : '';
	}

	WIN.addEventListener('dragenter', function (e) {
		if (!has_files(e))
			return;
		e.preventDefault();
		depth++;
		dz.hidden = false;
	});
	WIN.addEventListener('dragleave', function (e) {
		if (!has_files(e))
			return;
		if (--depth <= 0) {
			depth = 0;
			dz.hidden = true;
			set_over(null);
		}
	});
	WIN.addEventListener('dragover', function (e) {
		if (!has_files(e))
			return;
		e.preventDefault();
		var row = e.target.closest && e.target.closest('#pane [data-i]'),
			it = row ? S.vis[+row.getAttribute('data-i')] : null;
		set_over(it && it.dir ? row : null);
		e.dataTransfer.dropEffect = (it && it.dir) || up_target() ? 'copy' : 'none';
	});
	WIN.addEventListener('drop', function (e) {
		if (!has_files(e))
			return;
		e.preventDefault();
		depth = 0;
		dz.hidden = true;
		var it = over ? S.vis[+over.getAttribute('data-i')] : null,
			dst = it && it.dir ? it.path : up_target();
		set_over(null);
		if (!dst)
			return toast(S.route && S.route[0] == '!' ? 'open a folder first, then drop files into it' : 'you do not have write-access here', { err: true });
		from_datatransfer(e.dataTransfer).then(function (files) {
			if (!files.length)
				return toast('nothing to upload (empty folder?)');
			enqueue(files, dst);
		});
	});

	DOC.addEventListener('paste', function (e) {
		var tg = e.target;
		if (tg && (tg.tagName == 'INPUT' || tg.tagName == 'TEXTAREA' || tg.isContentEditable))
			return;
		var fs = Array.prototype.slice.call((e.clipboardData && e.clipboardData.files) || []);
		if (!fs.length)
			return;
		e.preventDefault();
		var dst = up_target();
		if (!dst)
			return toast('you cannot upload here', { err: true });

		var stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
		enqueue(fs.map(function (f, i) {
			if (/^image\.(png|jpe?g|gif|webp)$/i.test(f.name) || !f.name) {
				// clipboard screenshots are all called image.png; give them a unique name
				var ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
				try {
					f = new File([f], 'paste-' + stamp + (fs.length > 1 ? '-' + (i + 1) : '') + '.' + ext, { type: f.type, lastModified: Date.now() });
				}
				catch (ex) { }
			}
			return { file: f, rel: '' };
		}), dst);
	});

	ebi('fpick').onchange = function () {
		var dst = up_target();
		if (dst)
			enqueue(Array.prototype.slice.call(this.files).map(function (f) {
				return { file: f, rel: '' };
			}), dst);
		this.value = '';
	};
	ebi('dpick').onchange = function () {
		var dst = up_target();
		if (dst)
			enqueue(Array.prototype.slice.call(this.files).map(function (f) {
				var rp = (f.webkitRelativePath || f.name).split('/');
				rp.pop();
				return { file: f, rel: rp.length ? rp.join('/') + '/' : '' };
			}), dst);
		this.value = '';
	};
}

//
// input
//

function keys_init() {
	DOC.addEventListener('keydown', function (e) {
		var tg = e.target,
			k = e.key,
			ed = tg && (tg.tagName == 'INPUT' || tg.tagName == 'TEXTAREA' || tg.tagName == 'SELECT' || tg.isContentEditable);

		if (!ebi('sheet').hidden) {
			if (k == 'Escape')
				close_sheet();
			return;
		}
		if (ed) {
			if (k == 'Escape' && tg.id == 'filter') {
				tg.value = '';
				S.filter = '';
				render_pane();
				tg.blur();
			}
			if (k == 'Enter' && tg.id == 'filter')
				ebi('pane').focus();
			return;
		}
		if (e.altKey && k == 'ArrowUp')
			return up_dir(e);
		if (e.altKey || (e.ctrlKey && k != 'a') || (e.metaKey && k != 'a'))
			return;

		var g = S.view == 'grid' ? grid_cols() : 1;
		switch (k) {
			case 'j': case 'ArrowDown': move_cur(g); break;
			case 'k': case 'ArrowUp': move_cur(-g); break;
			case 'ArrowRight': if (S.view == 'grid') move_cur(1); else return; break;
			case 'ArrowLeft': if (S.view == 'grid') move_cur(-1); else return; break;
			case 'Home': move_cur(-1e9); break;
			case 'End': move_cur(1e9); break;
			case 'Enter': open_item(S.vis[S.cur]); break;
			case 'Backspace': return up_dir(e);
			case 'g': case 'G': toggle_view(); break;
			case 'i': case 'I': toggle_details(); break;
			case '/': ebi('filter').focus(); break;
			case 'Escape':
				close_menus();
				S.sel = {};
				S.cur = -1;
				paint_sel();
				break;
			case 'a':
				if (!(e.ctrlKey || e.metaKey)) return;
				S.vis.forEach(function (it) { S.sel[it.path] = 1; });
				paint_sel();
				break;
			default: return;
		}
		e.preventDefault();
	});
}

function up_dir(e) {
	if (S.route[0] == '!' || S.path == '/')
		return;
	e.preventDefault();
	want_sel = S.path;
	go(pparent(S.path));
}

function toggle_view() {
	S.view = S.view == 'grid' ? 'list' : 'grid';
	swrite('view', S.view);
	render_tools();
	render_pane();
}

function toggle_details() {
	var d = ebi('details');
	d.hidden = !d.hidden;
	swrite('details', !d.hidden);
	render_tools();
	render_details();
}

var pf_timer = null;

function pane_init() {
	var pane = ebi('pane');

	pane.addEventListener('click', function (e) {
		var el = e.target.closest('[data-i]');
		if (!el)
			return;
		var i = +el.getAttribute('data-i');
		if (TOUCH && !e.shiftKey && !e.ctrlKey && !e.metaKey)
			return open_item(S.vis[i]);
		click_item(i, e);
	});
	pane.addEventListener('dblclick', function (e) {
		var el = e.target.closest('[data-i]');
		if (el)
			open_item(S.vis[+el.getAttribute('data-i')]);
	});
	// prefetch folder listings on hover so the click feels instant
	pane.addEventListener('mouseover', function (e) {
		var el = e.target.closest && e.target.closest('[data-i]');
		clearTimeout(pf_timer);
		if (!el)
			return;
		var it = S.vis[+el.getAttribute('data-i')];
		if (it && it.dir && !CACHE[it.path])
			pf_timer = setTimeout(function () {
				fetch_ls(it.path).catch(function () { });
			}, 120);
	});
	ebi('tree').addEventListener('mouseover', function (e) {
		var a = e.target.closest && e.target.closest('a[href^="#/"]');
		clearTimeout(pf_timer);
		if (!a)
			return;
		var p = a.getAttribute('href').slice(1);
		if (!CACHE[p])
			pf_timer = setTimeout(function () {
				fetch_ls(p).catch(function () { });
			}, 120);
	});
}

function chrome_init() {
	ebi('b_menu').innerHTML = svg('menu');
	ebi('b_back').innerHTML = svg('back');
	ebi('b_fwd').innerHTML = svg('fwd');
	ebi('b_cfg').innerHTML = svg('cog');
	ebi('b_info').innerHTML = svg('info');
	QSA('.ico[data-i]').forEach(function (el) {
		el.innerHTML = svg(el.getAttribute('data-i'));
	});

	ebi('b_menu').onclick = function () {
		HTM.classList.toggle('rail');
	};
	ebi('b_back').onclick = function () {
		history.back();
	};
	ebi('b_fwd').onclick = function () {
		history.forward();
	};
	ebi('b_cfg').onclick = show_cfg;
	ebi('b_view').onclick = toggle_view;
	ebi('b_info').onclick = toggle_details;
	ebi('b_dir').onclick = function () {
		S.desc = !S.desc;
		swrite('desc', S.desc);
		render_tools();
		render_pane();
	};
	ebi('sort').onchange = function () {
		S.sort = this.value;
		swrite('sort', S.sort);
		render_tools();
		render_pane();
	};
	ebi('b_new').onclick = function (e) {
		e.stopPropagation();
		var m = ebi('newmenu'), wr = up_target();
		m.hidden = !m.hidden;
		QSA('button', m).forEach(function (b) {
			b.disabled = !wr;
			b.style.opacity = wr ? '' : '.45';
		});
		if (!wr && !m.hidden)
			toast(S.route[0] == '!' ? 'open a folder first' : 'this folder is read-only for you');
	};
	ebi('newmenu').onclick = function (e) {
		var b = e.target.closest('button');
		if (!b || b.disabled)
			return;
		var a = b.getAttribute('data-a');
		close_menus();
		if (a == 'mkdir') show_mkdir();
		if (a == 'upf') ebi('fpick').click();
		if (a == 'upd') ebi('dpick').click();
	};
	DOC.addEventListener('click', function (e) {
		if (!e.target.closest('#newmenu, #b_new, #acctmenu, #acct'))
			close_menus();
		if (HTM.classList.contains('rail') && !e.target.closest('#rail, #b_menu'))
			HTM.classList.remove('rail');
	});

	var ft = null;
	ebi('filter').addEventListener('input', function () {
		var v = this.value;
		clearTimeout(ft);
		ft = setTimeout(function () {
			S.filter = v.trim();
			S.cur = -1;
			render_pane();
		}, 80);
	});

	ebi('details').hidden = !sread('details', false) || WIN.innerWidth < 1100;
}

//
// boot
//

function boot() {
	apply_look();
	chrome_init();
	render_acct();
	keys_init();
	pane_init();
	marquee_init();
	drag_init();
	WIN.addEventListener('hashchange', route);
	route();
	tree_init();
	WIN.J_DRV = 2;
}

// test hooks for the smoke suite; harmless otherwise
WIN.DRV_T = { S: S, U: U, get_chunksize: get_chunksize, b64u: b64u, enqueue: enqueue };

boot();

})();
