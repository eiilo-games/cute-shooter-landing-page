#!/usr/bin/env node
// Terms and conditions versions, kept like the privacy policies. Each game's
// terms live in their own folder: index.html is the version in effect (the
// URL given to Google Play, App Store Connect and any trader declaration),
// and <YYYY-MM-DD>.html is each earlier version, named by the date it took
// effect. Old versions are never deleted.
//
//   node tools/terms.mjs list
//   node tools/terms.mjs new <terms> <YYYY-MM-DD> "What changed"
//   node tools/terms.mjs check
//
// <terms> is a key of TERMS below (the only line that differs between sites).
//
// `new` archives the current version (noindex, no canonical or og:url, an
// "old version" notice), moves index.html to the new date, adds a row on top
// of its "Changes and past versions" table, and updates the hub (if the site
// has one) and sitemap.xml. Then edit index.html with the new wording.
//
// `check` validates every version and exits non-zero on any problem; run it
// before every deploy. It also fails while a current page still holds a
// [[PLACEHOLDER]] (the trader details to fill in before first publication).
//
// Markers the tool relies on (keep them when editing a page):
//   <time class="effective" datetime="YYYY-MM-DD">…D Month YYYY…</time>
//   <!-- archived-notice --> where an old version shows its "old version" note
//   <tbody data-versions> with exactly one <tr data-current> row
//   on the hub: <time data-terms="<terms>" datetime="…">…</time>
//               and <span data-count="<terms>">N versions</span>

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---- per-site configuration ------------------------------------------------
// key -> folder (relative to the site root) holding index.html and archives.
const TERMS = {
	"cute-shooter": "terms",
};
// The page listing every game's terms, or null on a single-game site.
const HUB = null;
// -----------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITEMAP = join(ROOT, "sitemap.xml");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EFFECTIVE = /<time class="effective" datetime="(\d{4}-\d{2}-\d{2})">([^<]*)<\/time>/;
const NOTICE = "<!-- archived-notice -->";
const PLACEHOLDER = /\[\[[A-Z0-9_]+\]\]/g;

const read = (p) => readFileSync(p, "utf8");
const human = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const dayBefore = (iso) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plural = (n) => `${n} version${n === 1 ? "" : "s"}`;
const url = (name) => `/${TERMS[name]}`;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function fail(msg) { console.error(`error: ${msg}`); process.exit(1); }

function archives(name) {
	return readdirSync(join(ROOT, TERMS[name])).filter((f) => f.endsWith(".html") && DATE.test(f.slice(0, -5))).map((f) => f.slice(0, 10)).sort();
}

function effective(html, file) {
	const m = html.match(EFFECTIVE);
	if (!m) fail(`${file}: no <time class="effective" datetime="YYYY-MM-DD"> found`);
	return m[1];
}

function list() {
	for (const name of Object.keys(TERMS)) {
		const file = join(TERMS[name], "index.html");
		const past = archives(name);
		console.log(`${name.padEnd(22)} effective ${effective(read(join(ROOT, file)), file)}   ${plural(past.length + 1)}${past.length ? `   past: ${past.join(", ")}` : ""}`);
	}
}

function newVersion(name, date, summary) {
	if (!name || !date || !summary) fail('usage: node tools/terms.mjs new <terms> <YYYY-MM-DD> "What changed"');
	if (!(name in TERMS)) fail(`unknown terms "${name}" (known: ${Object.keys(TERMS).join(", ")})`);
	if (!DATE.test(date) || isNaN(Date.parse(date))) fail(`${date} is not a YYYY-MM-DD date`);
	const dir = join(ROOT, TERMS[name]);
	const indexPath = join(dir, "index.html");
	const html = read(indexPath);
	const old = effective(html, indexPath);
	if (date <= old) fail(`the new date ${date} must be after the current effective date ${old}`);
	const archivePath = join(dir, `${old}.html`);
	if (existsSync(archivePath)) fail(`${TERMS[name]}/${old}.html already exists`);
	if (!html.includes(NOTICE)) fail(`${TERMS[name]}/index.html: no ${NOTICE} marker`);

	// 1. The archived copy: not indexed, not canonical, marked as old.
	const archive = html
		.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex">')
		.replace(/\n<link rel="canonical"[^>]*>/, "")
		.replace(/\n<meta property="og:url"[^>]*>/, "")
		.replace(/<title>([^<]*)<\/title>/, `<title>$1 (${human(old)} version)</title>`)
		.replace(NOTICE, `<div class="archived" role="note"><strong>This is an old version of these terms.</strong> It was in effect from ${human(old)} to ${human(dayBefore(date))}. <a href="${url(name)}/">Read the current terms</a>.</div>`);
	writeFileSync(archivePath, archive);

	// 2. The current page: new date, and a new row on top of the history.
	let current = html.replace(EFFECTIVE, (_, d, text) => `<time class="effective" datetime="${date}">${text.replace(human(d), human(date))}</time>`);
	const row = /<tr data-current><td>[^<]*\(this version\)<\/td>/;
	if (!row.test(current)) fail(`${indexPath}: no <tr data-current> row in the versions table`);
	current = current.replace(row, `<tr><td><a href="${url(name)}/${old}.html">${human(old)}</a></td>`);
	current = current.replace(/(<tbody data-versions>\n?)(\s*)/, `$1$2<tr data-current><td>${human(date)} (this version)</td><td>${escape(summary)}</td></tr>\n$2`);
	writeFileSync(indexPath, current);

	// 3. The hub and the sitemap.
	if (HUB) {
		const hubPath = join(ROOT, HUB);
		let hub = read(hubPath);
		hub = hub.replace(new RegExp(`<time data-terms="${reEsc(name)}" datetime="[^"]*">[^<]*</time>`), `<time data-terms="${name}" datetime="${date}">${human(date)}</time>`);
		hub = hub.replace(new RegExp(`<span data-count="${reEsc(name)}">[^<]*</span>`), `<span data-count="${name}">${plural(archives(name).length + 1)}</span>`);
		writeFileSync(hubPath, hub);
	}
	if (existsSync(SITEMAP)) {
		const sm = read(SITEMAP).replace(new RegExp(`(<loc>https?://[^/<]+${reEsc(url(name))}/</loc>\\s*<lastmod>)[^<]*`), `$1${date}`);
		writeFileSync(SITEMAP, sm);
	}

	console.log(`archived  ${TERMS[name]}/${old}.html (in effect ${old} to ${dayBefore(date)})`);
	console.log(`updated   ${TERMS[name]}/index.html, now effective ${date}`);
	console.log(`updated   ${[HUB, existsSync(SITEMAP) && "sitemap.xml"].filter(Boolean).join(" and ") || "nothing else"}`);
	console.log(`\nNow edit ${TERMS[name]}/index.html with the new wording, then run: node tools/terms.mjs check`);
}

function check() {
	const problems = [];
	const hub = HUB ? read(join(ROOT, HUB)) : null;
	const sitemap = existsSync(SITEMAP) ? read(SITEMAP) : null;
	for (const name of Object.keys(TERMS)) {
		const dir = join(ROOT, TERMS[name]);
		const rel = (f) => `${TERMS[name]}/${f}`;
		if (!existsSync(join(dir, "index.html"))) { problems.push(`${rel("index.html")}: missing`); continue; }
		const html = read(join(dir, "index.html"));
		const m = html.match(EFFECTIVE);
		if (!m) { problems.push(`${rel("index.html")}: missing <time class="effective">`); continue; }
		const current = m[1];
		if (!m[2].includes(human(current))) problems.push(`${rel("index.html")}: effective date reads "${m[2]}", expected ${human(current)}`);
		const past = archives(name);

		const todo = [...new Set(html.match(PLACEHOLDER) || [])];
		if (todo.length) problems.push(`${rel("index.html")}: still has ${todo.join(", ")} to fill in`);
		if (!html.includes(NOTICE)) problems.push(`${rel("index.html")}: missing the ${NOTICE} marker`);
		if (/name="robots" content="noindex"/.test(html)) problems.push(`${rel("index.html")}: the current version must not be noindex`);
		if (html.includes('class="archived"')) problems.push(`${rel("index.html")}: the current version carries the archived notice`);
		if ((html.match(/<tr data-current>/g) || []).length !== 1) problems.push(`${rel("index.html")}: needs exactly one <tr data-current> row`);
		const cur = html.match(/<tr data-current><td>([^<]*) \(this version\)/);
		if (cur && cur[1] !== human(current)) problems.push(`${rel("index.html")}: table says ${cur[1]} but the page is effective ${human(current)}`);

		const linked = [...html.matchAll(new RegExp(`<a href="${reEsc(url(name))}/(\\d{4}-\\d{2}-\\d{2})\\.html">`, "g"))].map((x) => x[1]);
		for (const d of linked) if (!past.includes(d)) problems.push(`${rel("index.html")}: links ${d}.html, which does not exist`);
		for (const d of past) if (!linked.includes(d)) problems.push(`${rel("index.html")}: ${d}.html is not listed in the versions table`);

		const dates = [...past, current];
		past.forEach((d, i) => {
			const a = read(join(dir, `${d}.html`));
			const until = dayBefore(dates[i + 1]);
			if (!/name="robots" content="noindex"/.test(a)) problems.push(`${rel(d + ".html")}: missing noindex`);
			if (/rel="canonical"/.test(a)) problems.push(`${rel(d + ".html")}: an old version must not be canonical`);
			if (/property="og:url"/.test(a)) problems.push(`${rel(d + ".html")}: an old version must not claim og:url`);
			const e = a.match(EFFECTIVE);
			if (!e || e[1] !== d) problems.push(`${rel(d + ".html")}: effective date does not match the file name`);
			if (!a.includes(`in effect from ${human(d)} to ${human(until)}`)) problems.push(`${rel(d + ".html")}: archived notice should read "in effect from ${human(d)} to ${human(until)}"`);
		});
		if (current <= (past.at(-1) ?? "")) problems.push(`${TERMS[name]}: current date ${current} is not after the last archive`);

		if (hub) {
			const h = hub.match(new RegExp(`<time data-terms="${reEsc(name)}" datetime="([^"]*)">([^<]*)</time>`));
			if (!h) problems.push(`${HUB}: no <time data-terms="${name}">`);
			else if (h[1] !== current || h[2] !== human(current)) problems.push(`${HUB}: ${name} shows ${h[1]} but the terms are effective ${current}`);
			const c = hub.match(new RegExp(`<span data-count="${reEsc(name)}">([^<]*)</span>`));
			if (!c) problems.push(`${HUB}: no <span data-count="${name}">`);
			else if (c[1] !== plural(dates.length)) problems.push(`${HUB}: ${name} says "${c[1]}", expected "${plural(dates.length)}"`);
		}
		if (sitemap && !new RegExp(`<loc>https?://[^/<]+${reEsc(url(name))}/</loc>`).test(sitemap)) problems.push(`sitemap.xml: no entry for ${url(name)}/`);
	}
	if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
	console.log(`✓ ${Object.keys(TERMS).length} terms, all versions consistent`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "list") list();
else if (cmd === "new") newVersion(...args);
else if (cmd === "check") check();
else fail('usage: node tools/terms.mjs list | new <terms> <YYYY-MM-DD> "What changed" | check');
