// Headless soak test for the browser port: runs the real game on a stub
// canvas with a silent audio adapter and steps it deterministically. A bot
// steers through runs (weaving, firing both abilities, picking upgrades),
// every event and mystery outcome is forced at least once, and the menu,
// pause, game-over and save paths are exercised. Every frame is also drawn,
// so the draw code runs against the same state.
// `node test/soak.js [minutes-per-run]`
"use strict";
const CS = require("../game.js");

const minutes = +(process.argv[2] || 6);

// ------------------------------------------------------------- stubs -----
const ctx = new Proxy({}, {
	get: (_, k) => {
		if (k === "measureText") return (s) => ({ width: String(s).length * 20 });
		if (k === "createLinearGradient") return () => ({ addColorStop() {} });
		if (typeof k !== "string") return undefined;
		return function () {};
	},
	set: () => true,
});
const store = {};
const storage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
const audioLog = {};
const audio = new Proxy({}, { get: (_, k) => function (name) { if (k === "play") audioLog[name] = (audioLog[name] || 0) + 1; } });

// seeded rng so a failure can be replayed
let seed = 12345;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log("FAIL: " + msg); } }
const finite = (v) => typeof v === "number" && isFinite(v);

const game = CS.create({ audio, storage, random });
const DT = 1 / 60;
function step(n) { for (let i = 0; i < n; i++) { game.update(DT); game.draw(ctx); } }

// ---------------------------------------------------------- the bot ------
// Weaves left and right, leans toward green gates, fires the abilities when
// they are ready and takes the first upgrade card.
function botRun(seconds, forceAll) {
	game.startRun();
	const r0 = game.run;
	check(game.screen === "game", "startRun switches to the game");
	let t = 0, levelups = 0, maxEnemies = 0, sawPause = false;
	while (t < seconds) {
		const r = game.run;
		if (r !== r0) break;
		if (r.overlay === "levelup") { levelups++; game.debug.overlayAction("card" + Math.floor(random() * r.options.length)); }
		if (r.overlay === "gameover") break;
		const p = r.player;
		if (!p.dead && !r.paused) {
			let target = 360 + Math.sin(t * 1.1) * 280;
			r.gates.forEach((pair) => {
				if (pair.consumed || pair.y < p.y - 500 || pair.y > p.y) return;
				const good = pair.gates.slice().sort((a, b) => score(b, p) - score(a, p))[0];
				target = good.x;
			});
			p.targetX = target;
			if (p.bombCd <= 0 && r.enemies.length > 12) game.key("Space", true);
			if (p.zapCd <= 0 && p.hearts <= 1) game.key("KeyX", true);
			if (forceAll && p.hearts < 2) { p.hearts = p.maxHearts; }
		}
		if (!sawPause && t > 20) {
			sawPause = true;
			game.key("Escape", true);
			check(r.paused && r.overlay === "pause", "Escape pauses");
			const e0 = r.elapsed;
			step(30);
			check(r.elapsed === e0, "nothing moves while paused");
			game.key("Escape", true);
			check(!r.paused && !r.overlay, "Escape resumes");
		}
		step(1);
		t += DT;
		maxEnemies = Math.max(maxEnemies, r.enemies.length);
		// sanity on every entity
		if (!finite(r.score) || !finite(p.x) || !finite(p.power)) { check(false, "non-finite core state at t=" + t.toFixed(2)); break; }
		r.enemies.forEach((e) => { if (!finite(e.x) || !finite(e.y) || !finite(e.hp)) check(false, e.kind + " has a non-finite field"); });
		r.enemyBullets.forEach((b) => { if (!finite(b.x) || !finite(b.y)) check(false, "orb has a non-finite position"); });
		check(p.power >= 1, "power never drops below 1");
		check(r.bossesAlive >= 0 && r.bossesAlive <= 3, "bossesAlive stays in 0..3 (" + r.bossesAlive + ")");
	}
	return { run: game.run, t: t, levelups: levelups, maxEnemies: maxEnemies };
}
function score(g, p) {
	switch (g.op) {
		case "ADD": return g.value;
		case "SUB": return -g.value;
		case "MUL": return p.power * (g.value - 1);
		default: return -p.power / 2;
	}
}

// ---------------------------------------------------------- menu ---------
check(game.screen === "menu", "starts on the menu");
step(120);
game.save.coins = 1000;
game.debug.menuAction("buy:power");
check(game.save.meta.power === 1 && game.save.coins === 960, "buying Start Power costs 40");
game.debug.menuAction("buy:power");
check(game.save.meta.power === 2 && game.save.coins === 960 - 68, "second level costs round(40 * 1.7) = 68");
game.debug.menuAction("ship:green");
check(game.save.ship_color === "green", "ship colour is saved");
check(JSON.parse(store["cute-shooter-save"]).ship_color === "green", "save reaches storage");

// ---------------------------------------------------------- a forced run --
// Every event and every mystery outcome, on a run kept alive by the test.
game.startRun();
{
	const r = game.run;
	check(r.player.power === 11, "start power is 5 + 3 * meta level");
	r.player.invuln = 1e9;   // kept alive by the test, not by skill
	for (let i = 0; i < 150; i++) { step(60); if (r.overlay === "levelup") game.debug.overlayAction("card0"); }
	check(game.debug.challenge() > 2.6, "challenge climbs past 2.6 in 150 s (" + game.debug.challenge().toFixed(2) + ")");
	r.player.hearts = r.player.maxHearts;
	const seenEvents = {};
	for (let i = 0; i < 400 && Object.keys(seenEvents).length < 14; i++) {
		game.debug.runEvent();
		const f = r.fx[r.fx.length - 1];
		if (f && f.kind === "text") seenEvents[f.text] = true;
		step(5);
		r.player.hearts = r.player.maxHearts;
		r.player.dead = false;
		if (r.overlay === "levelup") game.debug.overlayAction("card0");
	}
	check(Object.keys(seenEvents).length >= 14, "all 14 events ran (" + Object.keys(seenEvents).join(", ") + ")");
	const seenMystery = {};
	for (let i = 0; i < 400 && Object.keys(seenMystery).length < 11; i++) {
		r.player.hearts = 3; r.player.dead = false; r.gameOver = false; r.gameoverAt = -1;
		game.debug.openMystery();
		const texts = r.fx.filter((f) => f.kind === "text").map((f) => f.text);
		const last = texts[texts.length - 1] || "";
		seenMystery[last.replace(/[0-9]+/g, "#")] = true;
		step(3);
		if (r.overlay === "levelup") game.debug.overlayAction("card0");
		if (r.overlay) { r.overlay = null; r.paused = false; }
	}
	check(Object.keys(seenMystery).length >= 11, "all 11 mystery outcomes ran (" + Object.keys(seenMystery).join(", ") + ")");
	game.toMenu();
}

// ---------------------------------------------------------- bot runs -----
let best = 0;
for (let i = 0; i < 4; i++) {
	const coins0 = game.save.coins;
	const res = botRun(minutes * 60, false);
	const r = res.run;
	if (r.overlay !== "gameover") {
		// still alive: end it the hard way so the game-over path runs too
		r.player.invuln = 0; r.player.hearts = 1; r.player.hasShield = false; r.player.zapTime = 0;
		r.enemyBullets.push({ x: r.player.x, y: r.player.y, vx: 0, vy: 0, rot: 0, touch: false, gone: false });
		step(2);
		check(r.gameOver, "a hit on the last heart ends the run");
		step(80);
	}
	check(r.overlay === "gameover", "game over screen appears after 1.1 s");
	check(r.last && r.last.score > 0 && r.last.score <= Math.floor(r.score), "final score is recorded");
	check(game.save.coins === coins0 + r.last.coins, "run coins are banked");
	best = Math.max(best, r.last.score);
	check(game.save.best_score >= best, "best score is kept");
	console.log("run " + (i + 1) + ": " + res.t.toFixed(0) + " s, score " + r.last.score + ", level " + r.level +
		", " + r.kills + " kills, " + res.levelups + " level-ups, peak " + res.maxEnemies + " enemies, power " + r.player.power);
	game.debug.overlayAction(i % 2 ? "retry" : "menu");
	if (game.screen === "menu") step(30);
	else game.toMenu();
}

// ---------------------------------------------------------- reload -------
const again = CS.create({ audio, storage, random });
check(again.save.best_score === game.save.best_score && again.save.coins === game.save.coins, "a fresh page loads the save");
["shoot", "hit", "pop", "boom", "gate_good", "gate_bad", "powerup", "coin", "hurt", "gameover", "click"].forEach((n) =>
	check(audioLog[n] > 0, "sound '" + n + "' was played"));

if (failures) { console.log(failures + " check(s) failed"); process.exit(1); }
console.log("OK");
