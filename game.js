/* Cute Shooter, browser edition.
 *
 * A port of the Godot scenes (scripts/main_menu.gd, game.gd, player.gd,
 * enemy.gd, gate.gd, gate_pair.gd, bullet.gd, enemy_bullet.gd, pickup.gd,
 * bomb.gd, hud.gd, overlays.gd, game_state.gd, ui_theme.gd) to a canvas.
 * The game keeps its own 720x1280 coordinate space, so every speed, radius,
 * timer and difficulty curve below is the same number as in the GDScript;
 * mount() scales that space to whatever size the page gives the canvas.
 *
 * Exposes window.CuteShooter = { WIDTH, HEIGHT, IMAGES, create, mount } in
 * the browser and module.exports in Node (test/soak.js runs it headless).
 *
 * The game never touches the Web Audio API itself. It talks to an "audio"
 * adapter (see audio.js); the default adapter is silent.
 */
(function (root, factory) {
	if (typeof module === "object" && module.exports) module.exports = factory();
	else root.CuteShooter = factory();
})(typeof self !== "undefined" ? self : this, function () {
	"use strict";

	const WIDTH = 720, HEIGHT = 1280;
	const TAU = Math.PI * 2;
	const FONT = "'Kenney Bold', 'Kenney Mini Square', 'Arial Rounded MT Bold', sans-serif";
	const STEP = 1 / 60;   // Godot's physics tick

	// ------------------------------------------------------------ helpers --
	const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
	const lerp = (a, b, t) => a + (b - a) * t;
	const moveToward = (a, b, d) => (Math.abs(b - a) <= d ? b : a + Math.sign(b - a) * d);
	const col = (r, g, b, a) => "rgba(" + Math.round(r * 255) + "," + Math.round(g * 255) + "," + Math.round(b * 255) + "," + (a === undefined ? 1 : a) + ")";
	const backOut = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
	const sineInOut = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
	const log2 = (x) => Math.log(x) / Math.LN2;
	const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

	// ui_theme.gd
	const NAVY = col(0.16, 0.2, 0.32);
	const NAVY_RGB = [0.16, 0.2, 0.32];
	const GREY_TEXT = col(0.35, 0.4, 0.55);
	const SKY = [0.47, 0.75, 0.97];

	// ------------------------------------------------------------- images --
	const SHIP_COLORS = ["pink", "blue", "green", "yellow", "beige"];
	const ENEMY_COLORS = ["blue", "green", "pink", "purple", "yellow"];
	const IMAGES = [];
	SHIP_COLORS.forEach((c) => IMAGES.push("ufo/ship_" + c, "ufo/mini_" + c, "ufo/laser_" + c));
	["blue", "green", "pink", "purple", "red", "yellow"].forEach((c) =>
		["circle", "rhombus", "square", "squircle"].forEach((s) => IMAGES.push("shapes/" + c + "_body_" + s)));
	"abcdefghijkl".split("").forEach((f) => IMAGES.push("shapes/face_" + f));
	IMAGES.push("shapes/coin", "fx/bomb", "fx/bomb_active", "fx/burst", "fx/orb", "fx/present", "fx/rock1", "fx/rock2",
		"fx/star1", "fx/star3", "ui/heart", "ui/btn_blue", "ui/btn_green", "ui/btn_grey", "ui/btn_red", "ui/btn_yellow",
		"ui/btn_round_green", "ui/btn_round_yellow", "ui/panel_blue", "ui/panel_grey");
	["bolt_gold", "pill_blue", "pill_green", "pill_red", "pill_yellow", "shield_gold", "speed", "star_gold", "things_gold"]
		.forEach((i) => IMAGES.push("icons/" + i));

	// ------------------------------------------------------------- tables --
	const UPGRADES = [
		{ id: "fire", name: "Rapid Fire", desc: "+20% fire rate", icon: "bolt_gold" },
		{ id: "dmg", name: "Big Bullets", desc: "+1 damage per bullet", icon: "star_gold" },
		{ id: "stream", name: "Extra Stream", desc: "One more bullet stream", icon: "things_gold", max: 3 },
		{ id: "heal", name: "Heal", desc: "Restore a heart (or +1 max if full)", icon: "heart" },
		{ id: "surge", name: "Power Surge", desc: "+30% power right now", icon: "pill_yellow" },
		{ id: "pierce", name: "Piercing", desc: "Bullets pass through +1 enemy", icon: "speed", max: 3 },
		{ id: "crit", name: "Lucky Shot", desc: "+10% chance of double damage", icon: "pill_red", max: 5 },
		{ id: "magnet", name: "Magnet", desc: "+80 coin pickup range", icon: "pill_blue", max: 4 },
		{ id: "speed", name: "Zoom Shots", desc: "+25% bullet speed", icon: "pill_green", max: 3 },
		{ id: "shield", name: "Bubble Shield", desc: "Blocks one hit, recharges in 18s", icon: "shield_gold", max: 1 },
	];
	const META_KEYS = ["power", "fire", "hearts", "coins", "magnet"];
	const META_DEFS = {
		power: { name: "Start Power", desc: "+3 starting power", max: 10, cost: 40, icon: "bolt_gold" },
		fire: { name: "Fire Rate", desc: "+8% fire rate", max: 10, cost: 60, icon: "star_gold" },
		hearts: { name: "Extra Heart", desc: "+1 max heart", max: 3, cost: 150, icon: "shield_gold" },
		coins: { name: "Coin Bonus", desc: "+20% coins earned", max: 5, cost: 80, icon: "pill_yellow" },
		magnet: { name: "Magnet", desc: "+50 pickup range", max: 5, cost: 50, icon: "things_gold" },
	};
	const BOSS_NAMES = ["BIG MEANIE!", "BIGGER MEANIE!", "HUGE MEANIE!", "GIANT MEANIE!", "MEGA MEANIE!", "COLOSSAL MEANIE!"];
	const MAX_BOSSES_ALIVE = 3;
	const CHALLENGE_PLATEAU = 3.5, CHALLENGE_RAMP_TIME = 75.0, CHALLENGE_TAIL = 1.0 / 420.0;
	const START_DPS = 2.8, BOSS_BASE_INTERVAL = 40.0, BOSS_MIN_INTERVAL = 8.0, INTENSITY_BASE = 3.0;
	const XP_UNIT = 12;
	const MYSTERY_OUTCOMES = [
		{ id: "power", w: 14, good: true }, { id: "heart", w: 10, good: true },
		{ id: "coins", w: 12, good: true }, { id: "kaboom", w: 10, good: true },
		{ id: "levelup", w: 8, good: true }, { id: "invincible", w: 8, good: true },
		{ id: "magnet", w: 8, good: true },
		{ id: "halve", w: 9, good: false }, { id: "ouch", w: 7, good: false },
		{ id: "clingers", w: 8, good: false }, { id: "slippery", w: 6, good: false },
	];
	const EVENT_NAMES = {
		SWARM: "SWARM!", COIN_RAIN: "COIN RAIN!", GATE_RUSH: "GATE RUSH!", SHOOTER_SQUAD: "SHOOTER SQUAD!",
		ASTEROIDS: "ASTEROIDS!", MINI_MEANIES: "MINI MEANIES!", CLINGERS: "CLINGERS!", METEOR_SHOWER: "METEOR SHOWER!",
		MINEFIELD: "MINEFIELD!", ROCK_WALL: "ROCK WALL!", DASH_SQUAD: "DASH SQUAD!", SPLITTERS: "SPLITTERS!",
		TANK_CONVOY: "TANK CONVOY!", ORB_CURTAIN: "ORB CURTAIN!",
	};

	// player.gd
	const STREAM_THRESHOLDS = [10, 25, 50, 100, 200];
	const SHIELD_RECHARGE = 18.0;
	const BOMB_COOLDOWN = 30.0, ZAP_SHIELD_COOLDOWN = 60.0, ZAP_SHIELD_DURATION = 5.0, ZAP_SHIELD_RADIUS = 170.0;
	const MAX_MINIS = 36, GOLDEN_ANGLE = 2.39996;
	// enemy.gd
	const MINE_TRIGGER_RADIUS = 150.0, MINE_RING = 8;
	const HAPPY_FACES = ["a", "c", "h", "k", "l"];
	// gate.gd
	const DIV_FLIP_HITS = 12;
	// bomb.gd
	const BOMB_RADIUS = 340.0, BOMB_FUSE = 0.5, BOMB_LAUNCH_SPEED = 1100.0, BOMB_BOSS_DAMAGE = 0.25;
	// hud.gd
	const ABILITY_SIZE = 104.0, ABILITY_GAP = 14.0;

	// ------------------------------------------------------------ storage --
	const SAVE_KEY = "cute-shooter-save";
	function memoryStorage() {
		const m = {};
		return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
	}

	// ------------------------------------------------------------- create --
	function create(opts) {
		opts = opts || {};
		const R = opts.random || Math.random;
		const randf = (a, b) => a + (b - a) * R();
		const randi = (a, b) => a + Math.floor(R() * (b - a + 1));
		const pick = (arr) => arr[Math.floor(R() * arr.length)];
		const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };
		const fromAngle = (a, len) => [Math.cos(a) * len, Math.sin(a) * len];

		const audio = opts.audio || { unlock() {}, setEnabled() {}, play() {}, music() {} };
		const images = opts.images || {};
		const storage = opts.storage || memoryStorage();
		const listeners = {};
		function emit(name, data) { (listeners[name] || []).forEach((f) => f(data)); }

		// --------------------------------------------- game_state.gd (Game) --
		const save = { coins: 0, best_score: 0, ship_color: "pink", meta: {}, sfx_on: true, music_on: true };
		META_KEYS.forEach((k) => { save.meta[k] = 0; });
		(function load() {
			let d = null;
			try { d = JSON.parse(storage.getItem(SAVE_KEY) || "null"); } catch (e) { d = null; }
			if (!d || typeof d !== "object") return;
			save.coins = Math.max(0, d.coins | 0);
			save.best_score = Math.max(0, d.best_score | 0);
			save.ship_color = SHIP_COLORS.indexOf(d.ship_color) >= 0 ? d.ship_color : "pink";
			save.sfx_on = d.sfx_on !== false;
			save.music_on = d.music_on !== false;
			META_KEYS.forEach((k) => { save.meta[k] = clamp((d.meta && d.meta[k]) | 0, 0, META_DEFS[k].max); });
		})();
		function persist() {
			try { storage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* private mode: keep going */ }
		}
		const metaLevel = (k) => save.meta[k] | 0;
		const metaCost = (k) => Math.round(META_DEFS[k].cost * Math.pow(1.7, metaLevel(k)));
		const metaMaxed = (k) => metaLevel(k) >= META_DEFS[k].max;
		const canBuy = (k) => !metaMaxed(k) && save.coins >= metaCost(k);
		const startPower = () => 5 + 3 * metaLevel("power");
		const maxHearts = () => 3 + metaLevel("hearts");
		const fireMult = () => 1.0 + 0.08 * metaLevel("fire");
		const coinMult = () => 1.0 + 0.2 * metaLevel("coins");
		const magnetRadius = () => 110.0 + 50.0 * metaLevel("magnet");

		audio.setEnabled(save.music_on, save.sfx_on);

		// Audio.play(name, db, pitch_var, min_interval)
		const lastPlay = {};
		let clock = 0;   // seconds since create, for min_interval
		function sfx(name, db, pitchVar, minInterval) {
			if (!save.sfx_on) return;
			if (minInterval > 0 && clock - (lastPlay[name] === undefined ? -100 : lastPlay[name]) < minInterval) return;
			lastPlay[name] = clock;
			audio.play(name, db || 0, pitchVar === undefined ? 0.08 : pitchVar);
		}
		const click = () => sfx("click", -4.0, 0.05);

		// ------------------------------------------------------- tweens ---
		// A tiny stand-in for Godot tweens: fn(k) gets 0..1, done() runs after.
		// "world" tweens freeze while the run is paused; "ui" ones never do.
		let tweens = [];
		function tween(dur, fn, done, opts2) {
			const tw = { t: 0, dur: dur, delay: (opts2 && opts2.delay) || 0, fn: fn, done: done, ui: !!(opts2 && opts2.ui), owner: opts2 && opts2.owner, dead: false };
			tweens.push(tw);
			fn(0);
			return tw;
		}
		function stepTweens(dt, paused) {
			const list = tweens;
			for (let i = 0; i < list.length; i++) {
				const tw = list[i];
				if (tw.dead || (paused && !tw.ui)) continue;
				if (tw.delay > 0) { tw.delay -= dt; if (tw.delay > 0) continue; }
				tw.t += dt;
				const k = Math.min(tw.t / tw.dur, 1);
				tw.fn(k);
				if (k >= 1) { tw.dead = true; if (tw.done) tw.done(); }
			}
			tweens = tweens.filter((t) => !t.dead);
		}

		// ======================================================== screens ===
		let screen = "menu";   // "menu" | "game"
		let run = null;
		const menu = { t: 0, pressed: null };

		// ============================================================ RUN ===
		function newRun() {
			tweens = [];
			const r = {
				elapsed: 0, score: 0, kills: 0, runCoins: 0, xp: 0, level: 1, xpNext: xpNeeded(1),
				gameOver: false, bossesAlive: 0, bossCount: 0, scrollSpeed: 130.0,
				spawnTimer: 1.6, gateTimer: 3.5, bossTimer: BOSS_BASE_INTERVAL, eventTimer: 22.0, mysteryTimer: 20.0,
				shake: 0, shakeX: 0, shakeY: 0, picked: {},
				gates: [], pickups: [], enemies: [], enemyBullets: [], bullets: [], fx: [], bombs: [],
				paused: false, overlay: null, overlayAlpha: 1, options: [], gameoverAt: -1, last: null,
				pressed: null, drag: null, keys: { left: false, right: false },
			};
			r.player = newPlayer(r);
			return r;
		}
		function xpNeeded(lvl) { return 2 * lvl * XP_UNIT; }

		// ---------------------------------------------------- difficulty ---
		function challenge(r) { return 1.0 + CHALLENGE_PLATEAU * (1.0 - Math.exp(-r.elapsed / CHALLENGE_RAMP_TIME)) + r.elapsed * CHALLENGE_TAIL; }
		function speedFactor(r) { return 1.0 + 0.25 * (challenge(r) - 1.0) + r.elapsed / 200.0; }
		function intensity(r) { const n = r.level, t = 1.0 + r.elapsed / 60.0; return n * log2(n + 1.0) * t + INTENSITY_BASE; }
		function bonusCap(r) { return Math.max(1, Math.floor(log2(r.level))); }
		function enemiesPerSec(r) { return Math.min(1.1 + 0.42 * intensity(r), 36.0); }
		function groupSize(r) { return clamp(1 + Math.floor(intensity(r) * 0.26), 1, 11); }
		function spawnInterval(r) { return clamp(groupSize(r) / enemiesPerSec(r), 0.25, 1.6); }
		function bossInterval(r) { return clamp(BOSS_BASE_INTERVAL / (1.0 + 0.12 * intensity(r)), BOSS_MIN_INTERVAL, BOSS_BASE_INTERVAL); }
		function refDps(r) {
			const expected = START_DPS * Math.pow(challenge(r), 2.2);
			const actual = r.player ? playerDps(r.player) : START_DPS;
			return Math.sqrt(expected * Math.max(actual, 1.0));
		}
		function hpGrowth(r) { return 1.0 + r.elapsed / 95.0; }
		function enemyHp(r, mult) {
			const c = challenge(r);
			const pressure = Math.min(0.7 + 0.16 * (c - 1.0), 1.5);
			return Math.max(1.0, refDps(r) * pressure / enemiesPerSec(r) * mult * hpGrowth(r));
		}
		function bossHp(r, n) { return refDps(r) * (5.0 + 1.5 * challenge(r)) * (1.0 + 0.3 * n) * hpGrowth(r); }

		// ========================================================= PLAYER ===
		function newPlayer(r) {
			const p = {
				color: save.ship_color, power: startPower(), hearts: maxHearts(), maxHearts: maxHearts(),
				fireRateMult: 1.0, damageBonus: 0, extraStreams: 0, bulletSpeedMult: 1.0, pierce: 0, critChance: 0.0,
				magnetBonus: 0.0, hasShield: false, shieldReady: false, shieldCooldown: 0.0, streamCap: 1,
				bombCd: 0.0, zapCd: 0.0, zapTime: 0.0,
				x: WIDTH / 2, y: HEIGHT - 190.0, targetX: WIDTH / 2, bounds: [56.0, WIDTH - 56.0], dead: false,
				fireCd: 0.0, invuln: 0.0, bob: 0.0, shipRot: 0.0, shipY: 0.0, shipSX: 1, shipSY: 1, shipVisible: true,
				labelScale: 1, minis: [], dyingMinis: [], clingers: [], lastDir: 0, reversals: 0, reversalTimer: 0.0, slowTimer: 0.0,
				shipTween: null, labelTween: null,
			};
			p.streamCap = bonusCap(r);
			updateCrowd(p);
			return p;
		}
		function setPower(p, v) {
			p.power = Math.max(1, Math.floor(v));
			if (p.labelTween) p.labelTween.dead = true;
			p.labelTween = tween(0.2, (k) => { p.labelScale = lerp(1.35, 1, backOut(k)); });
			updateCrowd(p);
		}
		function squash(p, sx, sy, dur, back) {
			if (p.shipTween) p.shipTween.dead = true;
			p.shipTween = tween(dur, (k) => { const e = back ? backOut(k) : k; p.shipSX = lerp(sx, 1, e); p.shipSY = lerp(sy, 1, e); });
		}
		function slot(i) {
			const rr = 20.0 + 15.0 * Math.sqrt(i), a = i * GOLDEN_ANGLE;
			return [Math.cos(a) * rr * 1.35, 62.0 + Math.sin(a) * rr * 0.75];
		}
		function updateCrowd(p) {
			const target = Math.min(p.power, MAX_MINIS);
			while (p.minis.length < target) {
				const s = slot(p.minis.length);
				const m = { x: s[0] + randf(-20, 20), y: s[1] + randf(-10, 10), rot: 0, scale: 0.05 };
				p.minis.push(m);
				tween(0.25, (k) => { m.scale = lerp(0.05, 0.3, backOut(k)); });
			}
			while (p.minis.length > target) {
				const m = p.minis.pop();
				const s0 = m.scale;
				p.dyingMinis.push(m);
				tween(0.15, (k) => { m.scale = lerp(s0, 0, k); }, () => { p.dyingMinis.splice(p.dyingMinis.indexOf(m), 1); });
			}
		}
		function moveCrowd(p, dt, dx) {
			const k = 1.0 - Math.exp(-7.0 * dt);
			for (let i = 0; i < p.minis.length; i++) {
				const m = p.minis[i];
				m.x -= dx;
				const s = slot(i);
				s[1] += Math.sin(p.bob * 1.3 + i * 0.9) * 4.0;
				m.x = lerp(m.x, s[0], k); m.y = lerp(m.y, s[1], k);
				m.rot = lerp(m.rot, clamp((s[0] - m.x) * -0.01, -0.5, 0.5), k);
			}
		}
		function streams(p) {
			let s = 1;
			STREAM_THRESHOLDS.forEach((th) => { if (p.power >= th) s += 1; });
			return clamp(s + p.extraStreams, 1, Math.min(p.streamCap, 7));
		}
		const shotsPerSec = (p) => clamp(2.5 + 0.06 * p.power, 2.5, 12.0) * p.fireRateMult * fireMult();
		const damage = (p) => 1 + Math.floor(p.power / 15) + p.damageBonus;
		const playerDps = (p) => streams(p) * shotsPerSec(p) * damage(p) * (1.0 + p.critChance);
		const zapActive = (p) => p.zapTime > 0.0;

		function playerPhysics(r, p, dt) {
			if (p.dead) return;
			let axis = (r.keys.right ? 1 : 0) - (r.keys.left ? 1 : 0);
			if (axis !== 0) p.targetX += axis * 900.0 * dt;
			p.targetX = clamp(p.targetX, p.bounds[0], p.bounds[1]);
			const oldX = p.x;
			let slow = Math.max(1.0 - 0.15 * p.clingers.length, 0.5);
			if (p.slowTimer > 0.0) { p.slowTimer -= dt; slow *= 0.45; }
			p.x = moveToward(p.x, p.targetX, 1700.0 * slow * dt);
			const dx = p.x - oldX;
			const vx = dx / Math.max(dt, 0.0001);
			trackWiggle(r, p, vx, dt);
			p.shipRot = lerp(p.shipRot, clamp(vx / 1700.0, -1.0, 1.0) * 0.32, 14.0 * dt);
			p.bob += dt * 4.0;
			p.shipY = Math.sin(p.bob) * 4.0;
			moveCrowd(p, dt, dx);

			if (p.hasShield && !p.shieldReady) {
				p.shieldCooldown -= dt;
				if (p.shieldCooldown <= 0.0) { p.shieldReady = true; sfx("powerup", -8.0); }
			}
			// _tick_abilities
			if (p.bombCd > 0.0) { p.bombCd -= dt; if (p.bombCd <= 0.0) sfx("coin", -6.0); }
			if (p.zapTime > 0.0) {
				p.zapTime -= dt;
				zapOverlaps(r, p);
				if (p.zapTime <= 0.0) sfx("pop", -8.0);
			}
			if (p.zapCd > 0.0) { p.zapCd -= dt; if (p.zapCd <= 0.0) sfx("coin", -6.0); }

			if (p.invuln > 0.0) {
				p.invuln -= dt;
				p.shipVisible = Math.floor(p.invuln * 16.0) % 2 === 0;
				if (p.invuln <= 0.0) p.shipVisible = true;
			}
			p.fireCd -= dt;
			if (p.fireCd <= 0.0) {
				shoot(r, p);
				p.fireCd = Math.max(p.fireCd + 1.0 / shotsPerSec(p), 0.0);
			}
		}
		function shoot(r, p) {
			const n = streams(p), dmg = damage(p);
			const spacing = n <= 4 ? 22.0 : 18.0;
			for (let i = 0; i < n; i++) {
				const k = i - (n - 1) / 2.0;
				const ang = n > 3 ? k * (4.0 * Math.PI / 180) : 0.0;
				const b = { x: p.x + k * spacing, y: p.y - 48.0, dx: Math.sin(ang), dy: -Math.cos(ang), color: p.color, damage: dmg,
					pierce: p.pierce, speed: 950.0 * p.bulletSpeedMult, crit: false, hit: [], gates: [], done: false };
				if (p.critChance > 0.0 && R() < p.critChance) { b.damage *= 2; b.crit = true; }
				r.bullets.push(b);
			}
			sfx("shoot", -16.0, 0.15, 0.07);
			squash(p, 0.96, 1.04, 0.1, false);
		}
		function takeHit(r, p, amount) {
			if (p.dead || p.invuln > 0.0 || zapActive(p)) return;
			if (p.hasShield && p.shieldReady) {
				p.shieldReady = false; p.shieldCooldown = SHIELD_RECHARGE; p.invuln = 0.5;
				sfx("gate_bad", -4.0);
				return;
			}
			sfx("hurt", 0.0, 0.05);
			setPower(p, p.power - amount);
			p.hearts -= 1;
			p.invuln = 1.0;
			if (p.hearts <= 0) playerDie(r, p);
		}
		function forceHurt(r, p) {
			if (p.dead) return;
			sfx("hurt", 0.0, 0.05);
			p.hearts -= 1;
			p.invuln = 1.0;
			if (p.hearts <= 0) playerDie(r, p);
		}
		function drain(p, amount) { if (!p.dead) setPower(p, p.power - amount); }
		function heal(p, n) { p.hearts = Math.min(p.hearts + n, p.maxHearts); }
		function raiseMaxHearts(p, n) { p.maxHearts += n; p.hearts = Math.min(p.hearts + n, p.maxHearts); }
		function trackWiggle(r, p, vx, dt) {
			p.reversalTimer -= dt;
			if (p.reversalTimer <= 0.0) p.reversals = 0;
			if (Math.abs(vx) < 500.0) return;
			const d = vx > 0.0 ? 1 : -1;
			if (p.lastDir !== 0 && d !== p.lastDir) {
				p.reversals += 1;
				p.reversalTimer = 0.55;
				if (p.reversals >= 4 && p.clingers.length) {
					p.reversals = 0;
					p.clingers.slice().forEach((c) => shakeOff(r, c));
					p.clingers = [];
					squash(p, 1.25, 0.8, 0.25, true);
				}
			}
			p.lastDir = d;
		}
		function playerDie(r, p) {
			p.dead = true;
			p.zapTime = 0.0;
			onPlayerDied(r);
		}
		function zapOverlaps(r, p) {
			r.enemies.forEach((e) => { if (!e.dead && dist(e.x, e.y, p.x, p.y) < ZAP_SHIELD_RADIUS + 66 * e.scale) takeDamage(r, e, 999999, false); });
			r.enemyBullets.forEach((b) => { if (!b.gone && dist(b.x, b.y, p.x, p.y) < ZAP_SHIELD_RADIUS + 18) b.gone = true; });
		}

		// --------------------------------------------------- abilities ---
		function useBomb(r) {
			const p = r.player;
			if (r.gameOver || p.dead || p.bombCd > 0.0) return;
			p.bombCd = BOMB_COOLDOWN;
			squash(p, 1.2, 0.85, 0.25, true);
			const b = { x: p.x, y: p.y - 70, t: 0, exploded: false, wave: 0, scale: 0.4, tex: "fx/bomb", rot: 0 };
			tween(0.2, (k) => { b.scale = lerp(0.4, 1, backOut(k)); });
			r.bombs.push(b);
			sfx("shoot", -4.0, 0.05);
		}
		function useZapShield(r) {
			const p = r.player;
			if (r.gameOver || p.dead || p.zapCd > 0.0) return;
			p.zapCd = ZAP_SHIELD_COOLDOWN;
			p.zapTime = ZAP_SHIELD_DURATION;
			sfx("powerup", 0.0);
			floatText(r, "ZAP SHIELD!", p.x, p.y - 230, [1, 0.92, 0.55], 44);
			shake(r, 3.0);
		}
		function bombPhysics(r, b, dt) {
			if (b.exploded) return;
			b.t += dt;
			const k = clamp(b.t / BOMB_FUSE, 0, 1);
			b.y -= lerp(BOMB_LAUNCH_SPEED, BOMB_LAUNCH_SPEED * 0.35, k) * dt;
			b.rot = Math.sin(b.t * 12.0) * 0.35;
			b.tex = Math.floor(b.t * (8.0 + 40.0 * k)) % 2 === 1 ? "fx/bomb_active" : "fx/bomb";
			if (b.t >= BOMB_FUSE) {
				b.exploded = true;
				bombBlast(r, b.x, b.y, BOMB_RADIUS);
				tween(0.45, (kk) => { b.wave = kk; }, () => { b.gone = true; });
			}
		}
		function bombBlast(r, x, y, radius) {
			let n = 0;
			r.enemies.forEach((e) => {
				if (e.dead) return;
				if (dist(e.x, e.y, x, y) > radius + 50.0 * e.bodyScale) return;
				if (e.kind === "BOSS") takeDamage(r, e, Math.max(1, Math.ceil(e.maxHp * BOMB_BOSS_DAMAGE)), true);
				else { takeDamage(r, e, 999999, false); n += 1; }
			});
			r.enemyBullets.forEach((b) => { if (dist(b.x, b.y, x, y) <= radius + 40.0) b.gone = true; });
			spawnBurst(r, x, y, [1, 0.85, 0.55], 3.2);
			shake(r, 18.0);
			sfx("boom", 0.0);
			if (n > 0) floatText(r, "KABOOM! x" + n, x, y, [1, 0.9, 0.5], 48);
		}

		// ========================================================= ENEMIES ===
		function spawnEnemy(r, kind, x, y, hpMult, bodyScale) {
			hpMult = hpMult === undefined ? 1.0 : hpMult;
			const e = {
				kind: kind, hp: 3, maxHp: 3, speed: 40, scroll: r.scrollSpeed, amp: 20, baseX: x, hoverY: 230,
				scoreValue: 10, xpValue: 1, bodyScale: 0.75, spreadCount: 3, isMini: false, leaveAfter: 42.0,
				attached: false, ax: 0, ay: 0, vx: 0, vy: 0, drainTimer: 0, dashState: 0, dashDir: [0, 1], dashTimer: 0,
				exploded: false, color: "", t: R() * TAU, life: 0, dead: false, shootTimer: 2.0, faceTimer: 0,
				x: x, y: y, scale: 1, alpha: 1, bodyRot: 0, wob: 1, flash: 0, flashTween: null, glow: 0, touch: false, gone: false,
			};
			const c = challenge(r), sm = speedFactor(r);
			switch (kind) {
				case "SQUARE": e.hp = enemyHp(r, 1.0 * hpMult); e.speed = 40.0 * sm; e.amp = 20.0; e.scoreValue = 10; break;
				case "CIRCLE": e.hp = enemyHp(r, 0.6 * hpMult); e.speed = 130.0 * sm; e.amp = 110.0; e.scoreValue = 15; break;
				case "RHOMBUS": e.hp = enemyHp(r, 1.6 * hpMult); e.speed = 15.0 * sm; e.amp = 40.0; e.scoreValue = 25; e.xpValue = 2; break;
				case "CLINGER": e.hp = enemyHp(r, 0.5 * hpMult); e.speed = 230.0 * sm; e.scoreValue = 30; e.xpValue = 2; e.bodyScale = 0.6; break;
				case "ROCK": e.hp = enemyHp(r, 3.0 * hpMult); e.speed = 30.0 * sm; e.amp = 30.0; e.scoreValue = 20; e.bodyScale = randf(0.7, 1.1); break;
				case "SPLITTER": e.hp = enemyHp(r, 1.4 * hpMult); e.speed = 30.0 * sm; e.amp = 30.0; e.scoreValue = 20; e.xpValue = 2; e.bodyScale = 0.95; break;
				case "DASHER": e.hp = enemyHp(r, 0.55 * hpMult); e.speed = (620.0 + 60.0 * c) * sm; e.amp = 26.0; e.scoreValue = 20; e.bodyScale = 0.7; break;
				case "TANK": e.hp = enemyHp(r, 4.5 * hpMult); e.speed = 12.0 * sm; e.amp = 50.0; e.scoreValue = 45; e.xpValue = 3; e.bodyScale = 1.15; break;
				case "MINE": e.hp = enemyHp(r, 1.2 * hpMult); e.speed = 20.0 * sm; e.amp = 24.0; e.scoreValue = 15; e.bodyScale = 0.7; break;
				case "METEOR": {
					e.hp = enemyHp(r, 0.8 * hpMult); e.speed = 0.0; e.scoreValue = 15; e.bodyScale = 0.65;
					let vx = randf(-1.0, 1.0), vy = randf(0.8, 1.2);
					const l = Math.hypot(vx, vy), s = (380.0 + 40.0 * c) * sm;
					e.vx = vx / l * s; e.vy = vy / l * s;
					break;
				}
				case "BOSS": {
					const n = r.bossCount;
					e.bodyScale = Math.min(1.4 + 0.22 * n, 2.8);
					e.hp = bossHp(r, n) * hpMult;
					e.speed = 170.0 * sm;
					e.hoverY = 240.0 + 80.0 * e.bodyScale;
					e.spreadCount = Math.min(3 + n, 9);
					e.scoreValue = Math.floor(200.0 * c * (1.0 + 0.5 * n));
					e.xpValue = 8 + 2 * n;
					break;
				}
			}
			if (bodyScale > 0.0) e.bodyScale = bodyScale;
			enemyReady(e);
			r.enemies.push(e);
			return e;
		}
		// Enemy._ready
		function enemyReady(e) {
			e.maxHp = e.hp;
			let shape = "square", face = pick(HAPPY_FACES);
			switch (e.kind) {
				case "CIRCLE": shape = "circle"; break;
				case "RHOMBUS": shape = "rhombus"; face = "f"; e.color = "red"; break;
				case "BOSS": shape = "squircle"; face = "g"; e.color = "purple"; break;
				case "CLINGER": shape = "circle"; face = "d"; e.color = "pink"; break;
				case "SPLITTER": shape = "square"; face = "e"; e.color = "purple"; break;
				case "DASHER": shape = "rhombus"; face = "b"; e.color = "green"; break;
				case "TANK": shape = "squircle"; face = "c"; e.color = "blue"; break;
			}
			if (e.color === "") e.color = pick(ENEMY_COLORS);
			e.bodySX = 1; e.tint = null;
			if (e.kind === "ROCK") { e.body = "fx/rock" + randi(1, 2); e.bodySX = 1.7; }
			else if (e.kind === "METEOR") { e.body = "fx/rock" + randi(1, 2); e.bodySX = 1.3; e.tint = [1.0, 0.8, 0.6]; }
			else if (e.kind === "MINE") { e.body = "fx/star" + (R() < 0.5 ? 1 : 3); e.bodySX = 1.6; e.tint = [1.0, 0.45, 0.5]; }
			else e.body = "shapes/" + e.color + "_body_" + shape;
			e.normalFace = face; e.face = face;
			e.fontPx = Math.floor(28.0 * e.bodyScale) + 8;
			e.scale = e.bodyScale;
			e.shootTimer = randf(1.5, 2.5);
		}
		const faceless = (e) => e.kind === "ROCK" || e.kind === "METEOR" || e.kind === "MINE";
		function popFace(e, key, dur) { e.face = key; e.faceTimer = dur; }

		function enemyPhysics(r, e, dt) {
			if (e.dead) return;
			e.t += dt; e.life += dt;
			const bottom = HEIGHT, width = WIDTH, p = r.player;
			const c = challenge(r);
			switch (e.kind) {
				case "SQUARE":
					e.y += (e.scroll + e.speed) * dt; e.x = e.baseX + Math.sin(e.t * 1.5) * e.amp; break;
				case "CIRCLE":
					e.y += (e.scroll + e.speed) * dt; e.x = clamp(e.baseX + Math.sin(e.t * 3.0) * e.amp, 50, width - 50); break;
				case "RHOMBUS":
					e.y += (e.scroll * 0.55 + e.speed) * dt; e.x = e.baseX + Math.sin(e.t * 1.2) * e.amp;
					e.shootTimer -= dt;
					if (e.shootTimer <= 0.0 && e.y > 40 && e.y < bottom - 300) {
						e.shootTimer = randf(2.0, 2.8) / c;
						if (!p.dead) {
							let dx = p.x - e.x, dy = p.y - e.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
							const spd = 280.0 + 40.0 * c;
							spawnEnemyBullet(r, e.x + dx * 60, e.y + dy * 60, dx * spd, dy * spd);
							popFace(e, "f", 0.3);
						}
					}
					break;
				case "ROCK":
					e.y += (e.scroll * 0.8 + e.speed) * dt; e.x = e.baseX + Math.sin(e.t * 0.7) * e.amp; e.bodyRot += 0.8 * dt; break;
				case "CLINGER": {
					if (e.attached) {
						if (p.dead) { die(r, e, false); return; }
						e.x = p.x + e.ax + Math.sin(e.t * 12.0) * 4.0;
						e.y = p.y + e.ay + Math.cos(e.t * 9.0) * 3.0;
						e.drainTimer -= dt;
						if (e.drainTimer <= 0.0) { e.drainTimer = 0.5; drain(p, 1); popFace(e, "g", 0.2); }
						return;
					}
					const tx = !p.dead ? p.x : e.baseX, ty = !p.dead ? p.y : bottom + 200.0;
					let dx = tx - e.x, dy = ty - e.y; let l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
					dy = Math.max(dy, 0.15);
					l = Math.hypot(dx, dy) || 1;
					e.x += dx / l * e.speed * dt + Math.sin(e.t * 8.0) * 60.0 * dt;
					e.y += dy / l * e.speed * dt;
					if (e.life > 25.0) e.y += e.scroll * dt;
					break;
				}
				case "SPLITTER":
					e.y += (e.scroll * 0.9 + e.speed) * dt; e.x = e.baseX + Math.sin(e.t * 1.0) * e.amp; break;
				case "TANK":
					e.y += (e.scroll * 0.55 + e.speed) * dt; e.x = e.baseX + Math.sin(e.t * 0.5) * e.amp;
					e.shootTimer -= dt;
					if (e.shootTimer <= 0.0 && e.y > 40 && e.y < bottom - 350) {
						e.shootTimer = randf(2.6, 3.4) / c;
						spawnEnemyBullet(r, e.x, e.y + 70.0 * e.bodyScale, 0, 170.0 + 20.0 * c);
						popFace(e, "g", 0.3);
					}
					break;
				case "DASHER":
					e.dashTimer -= dt;
					if (e.dashState === 0) {
						e.y += (e.scroll * 0.6 + e.speed * 0.4) * dt;
						e.x = e.baseX + Math.sin(e.t * 2.0) * e.amp;
						if (e.y > 110.0 && e.dashTimer <= 0.0) { e.dashState = 1; e.dashTimer = 0.55; popFace(e, "g", 0.6); e.glow = 0.45; }
					} else if (e.dashState === 1) {
						e.x = e.baseX + Math.sin(e.t * 40.0) * 6.0;
						if (e.dashTimer <= 0.0) {
							e.dashState = 2; e.glow = 0;
							const tx = !p.dead ? p.x : e.x, ty = !p.dead ? p.y : bottom + 300.0;
							let dx = tx - e.x, dy = ty - e.y; let l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
							dy = Math.max(dy, 0.45); l = Math.hypot(dx, dy);
							e.dashDir = [dx / l, dy / l];
							sfx("shoot", -12.0, 0.4);
						}
					} else {
						e.x += e.dashDir[0] * e.speed * dt; e.y += e.dashDir[1] * e.speed * dt;
						e.bodyRot = lerp(e.bodyRot, Math.atan2(e.dashDir[1], e.dashDir[0]) - Math.PI / 2, 10.0 * dt);
					}
					break;
				case "MINE":
					e.y += (e.scroll * 0.7 + e.speed) * dt; e.x = e.baseX + Math.sin(e.t * 0.9) * e.amp; e.bodyRot += 1.6 * dt;
					if (!p.dead && dist(e.x, e.y, p.x, p.y) < MINE_TRIGGER_RADIUS) { die(r, e, false); return; }
					break;
				case "METEOR":
					e.x += e.vx * dt; e.y += e.vy * dt; e.y += e.scroll * 0.5 * dt; e.bodyRot += 3.0 * dt;
					if (e.x < -160.0 || e.x > width + 160.0) { removeEnemy(r, e); return; }
					break;
				case "BOSS":
					if (e.life > e.leaveAfter) {
						e.y -= 320 * dt;
						if (e.y < -400) { removeEnemy(r, e); return; }
					} else if (e.y < e.hoverY) {
						e.y += e.speed * dt;
					} else {
						const sway = Math.max(width / 2.0 - 90.0 * e.bodyScale, 40.0);
						e.x = width / 2.0 + Math.sin(e.t * 0.8) * sway;
						e.shootTimer -= dt;
						if (e.shootTimer <= 0.0) { e.shootTimer = Math.max(1.0, 3.2 - 0.4 * c); shootSpread(r, e); }
					}
					break;
			}
			if (e.y > bottom + 160) {
				if (e.kind !== "BOSS") onEnemyLeaked(r, e);
				removeEnemy(r, e);
				return;
			}
			if (!faceless(e)) e.wob = 1.0 + 0.035 * Math.sin(e.t * 6.0);
			if (e.faceTimer > 0.0) { e.faceTimer -= dt; if (e.faceTimer <= 0.0) e.face = e.normalFace; }
		}
		function removeEnemy(r, e) {
			if (e.gone) return;
			e.gone = true;
			if (e.kind === "BOSS" && !e.isMini) r.bossesAlive = Math.max(r.bossesAlive - 1, 0);
		}
		function shootSpread(r, e) {
			const n = e.spreadCount, c = challenge(r);
			const total = Math.min(24.0 * (n - 1), 150.0) * Math.PI / 180;
			for (let i = 0; i < n; i++) {
				const ang = -total / 2.0 + total * i / Math.max(n - 1, 1);
				const dx = -Math.sin(ang), dy = Math.cos(ang);   // Vector2.DOWN.rotated(ang)
				const spd = 220.0 + 30.0 * c;
				spawnEnemyBullet(r, e.x + dx * 90.0 * e.bodyScale, e.y + dy * 90.0 * e.bodyScale, dx * spd, dy * spd);
			}
			popFace(e, "g", 0.4);
		}
		function takeDamage(r, e, amount, crit) {
			if (e.dead) return;
			e.hp -= amount;
			if (e.flashTween) e.flashTween.dead = true;
			const f0 = crit ? 1.1 : 0.8;
			e.flashTween = tween(0.14, (k) => { e.flash = f0 * (1 - k); });
			popFace(e, "i", 0.25);
			sfx("hit", -10.0, 0.25, 0.035);
			if (e.hp <= 0.0) die(r, e, true);
		}
		function contactPlayer(r, e, p) {
			if (e.dead) return;
			if (e.kind === "CLINGER") { if (!e.attached) attach(r, e, p); return; }
			takeHit(r, p, Math.max(1, Math.ceil(e.hp)));
			if (e.kind !== "BOSS") die(r, e, false);
		}
		function attach(r, e, p) {
			e.attached = true;
			e.ax = randf(-42.0, 42.0); e.ay = -66.0;
			e.drainTimer = 0.4;
			if (p.clingers.indexOf(e) < 0) p.clingers.push(e);
			popFace(e, "l", 0.6);
			sfx("pop", -4.0, 0.3);
			floatText(r, "STUCK! WIGGLE!", e.x, e.y - 60, [1, 0.7, 0.85], 34);
		}
		function shakeOff(r, e) {
			if (e.dead) return;
			e.attached = false;
			die(r, e, true);
		}
		function die(r, e, byPlayer) {
			if (e.dead) return;
			e.dead = true;
			if (e.attached) { const i = r.player.clingers.indexOf(e); if (i >= 0) r.player.clingers.splice(i, 1); }
			if (e.kind === "MINE") explodeRing(r, e);
			else if (e.kind === "SPLITTER" && byPlayer) spawnSplits(r, e.x, e.y, 3);
			if (byPlayer) onEnemyKilled(r, e);
			else spawnBurst(r, e.x, e.y, [1, 1, 1], 0.8, 0.8);
			e.face = "j";
			const s0 = e.scale, y0 = e.y;
			tween(0.3, (k) => { e.scale = lerp(s0, s0 * 1.35, k); e.alpha = 1 - k; e.y = y0 + 40.0 * k; }, () => removeEnemy(r, e));
		}
		function explodeRing(r, e) {
			if (e.exploded) return;
			e.exploded = true;
			const c = challenge(r);
			for (let i = 0; i < MINE_RING; i++) {
				const a = TAU * i / MINE_RING + e.t, dx = Math.cos(a), dy = Math.sin(a), spd = 230.0 + 20.0 * c;
				spawnEnemyBullet(r, e.x + dx * 20.0, e.y + dy * 20.0, dx * spd, dy * spd, true);
			}
			spawnBurst(r, e.x, e.y, [1, 0.6, 0.6], 1.4);
			shake(r, 7.0);
			sfx("boom", -8.0, 0.2);
		}
		function spawnSplits(r, x, y, n) {
			for (let i = 0; i < n; i++) {
				const k = i - (n - 1) / 2.0;
				const px = clamp(x + k * 70.0, 50.0, WIDTH - 50.0);
				const e = spawnEnemy(r, "CIRCLE", px, y + randf(-10.0, 20.0), 0.28, 0.45);
				e.speed *= 1.3; e.amp = 60.0; e.scoreValue = 5; e.xpValue = 0;
			}
		}

		// ----------------------------------------------------- spawning ---
		function pickKind(r) {
			const c = challenge(r);
			const weights = [
				["SQUARE", 10.0],
				["CIRCLE", c > 1.4 ? 6.0 : 0.0],
				["CLINGER", c > 1.5 ? 2.0 + 0.8 * c : 0.0],
				["DASHER", c > 1.7 ? 1.5 + 0.8 * c : 0.0],
				["RHOMBUS", c > 1.8 ? 1.5 + 1.0 * c : 0.0],
				["SPLITTER", c > 2.0 ? 1.0 + 0.8 * c : 0.0],
				["MINE", c > 2.2 ? 1.0 + 0.6 * c : 0.0],
				["TANK", c > 2.6 ? 0.5 + 0.6 * c : 0.0],
			];
			let total = 0;
			weights.forEach((w) => { total += w[1]; });
			let roll = R() * total;
			for (let i = 0; i < weights.length; i++) { roll -= weights[i][1]; if (roll <= 0.0) return weights[i][0]; }
			return "SQUARE";
		}
		function spawnWave(r) {
			const pr = R(), kind = pickKind(r), margin = 75.0, w = WIDTH, n = groupSize(r);
			if (n === 1 || pr < 0.25) spawnEnemy(r, kind, randf(margin, w - margin), -120.0);
			else if (pr < 0.6) {
				const row = Math.min(n, 7);
				for (let i = 0; i < row; i++) spawnEnemy(r, kind, margin + (w - 2.0 * margin) * (i + 0.5) / row, -120.0);
			} else if (pr < 0.82) {
				const half = Math.min(Math.floor(n / 2), 2);
				for (let i = -half; i <= half; i++) spawnEnemy(r, kind, w / 2.0 + i * 130.0, -120.0 - Math.abs(i) * 95.0);
			} else {
				const x = randf(margin, w - margin);
				for (let i = 0; i < Math.min(n, 8); i++) spawnEnemy(r, kind, x, -120.0 - i * 140.0);
			}
		}
		function spawnBoss(r) {
			r.bossesAlive += 1;
			spawnEnemy(r, "BOSS", WIDTH / 2.0 + randf(-120, 120), -300.0);
			const label = r.bossCount < BOSS_NAMES.length ? BOSS_NAMES[r.bossCount] : "MEANIE #" + (r.bossCount + 1) + "!";
			floatText(r, label, WIDTH / 2.0, HEIGHT * 0.35, [1, 0.75, 0.85], 52);
			shake(r, 6.0 + 2.0 * r.bossCount);
			r.bossCount += 1;
		}
		function spawnGatePair(r, y) {
			y = y === undefined ? -160.0 : y;
			const gateW = WIDTH / 2.0 - 36.0;
			const pw = Math.max(r.player.power, 2), c = challenge(r);
			let a = { op: "ADD", value: 3 }, b = { op: "SUB", value: 3 };
			const rr = R();
			if (rr < 0.42) {
				a.value = Math.max(2, Math.ceil(pw * randf(0.2, 0.45)));
				b.value = Math.max(2, Math.ceil(pw * randf(0.25, 0.35 + 0.08 * c)));
			} else if (rr < 0.66) {
				a.value = Math.max(3, Math.ceil(pw * randf(0.4, 0.8)));
				b = { op: "MUL", value: 2 };
			} else if (rr < 0.86) {
				a = { op: "MUL", value: R() < 0.8 ? 2 : 3 };
				b = { op: "SUB", value: Math.max(3, Math.ceil(pw * randf(0.3, 0.35 + 0.1 * c))) };
			} else {
				a = { op: "DIV", value: 2 };
				b = { op: "SUB", value: Math.max(3, Math.ceil(pw * randf(0.4, 0.4 + 0.12 * c))) };
			}
			if (R() < 0.5) { const t = a; a = b; b = t; }
			const pair = { y: y, scroll: r.scrollSpeed, consumed: false, alpha: 1, scale: 1, gates: [] };
			[[a, WIDTH * 0.25], [b, WIDTH * 0.75]].forEach((g) => {
				pair.gates.push({ op: g[0].op, value: g[0].value, base: g[0].value, x: g[1], w: gateW, h: 120, hits: 0, used: false, punch: 1, punchTween: null });
			});
			r.gates.push(pair);
		}
		function gateText(g) {
			switch (g.op) {
				case "ADD": return "+" + g.value;
				case "SUB": return "-" + g.value;
				case "MUL": return "x" + g.value;
				default: return "÷" + g.value;
			}
		}
		const gatePositive = (g) => g.op === "ADD" || g.op === "MUL";
		function gateBulletHit(g) {
			if (g.used) return;
			g.hits += 1;
			let changed = false;
			if (g.op === "ADD") { if (g.value < g.base * 2 + 5) { g.value += 1; changed = true; } }
			else if (g.op === "SUB") {
				g.value -= 1; changed = true;
				if (g.value <= 0) { g.op = "ADD"; g.value = 1; sfx("powerup", -6.0); }
			} else if (g.op === "DIV") {
				if (g.value > 1 && g.hits >= DIV_FLIP_HITS) { g.op = "ADD"; g.value = 2; changed = true; sfx("powerup", -6.0); }
			}
			if (changed) {
				if (g.punchTween) g.punchTween.dead = true;
				g.punchTween = tween(0.15, (k) => { g.punch = lerp(1.18, 1, k); });
			}
		}
		function gateApply(r, pair, g, p) {
			if (g.used) return;
			const before = p.power;
			if (g.op === "ADD") setPower(p, p.power + g.value);
			else if (g.op === "SUB") setPower(p, p.power - g.value);
			else if (g.op === "MUL") setPower(p, p.power * g.value);
			else setPower(p, Math.ceil(p.power / g.value));
			const diff = p.power - before;
			if (diff >= 0) sfx("gate_good", -2.0); else sfx("gate_bad", -2.0);
			floatText(r, diff >= 0 ? "+" + diff : String(diff), p.x, p.y - 150, diff >= 0 ? [0.55, 1.0, 0.6] : [1.0, 0.5, 0.55], 48);
			// GatePair.consume
			if (pair.consumed) return;
			pair.consumed = true;
			pair.gates.forEach((gg) => { gg.used = true; });
			tween(0.35, (k) => { pair.alpha = 1 - k; pair.scale = lerp(1, 1.08, k); }, () => { pair.gone = true; });
		}
		function spawnEnemyBullet(r, x, y, vx, vy, silent) {
			const m = 1.0 + r.elapsed / 300.0;
			r.enemyBullets.push({ x: x, y: y, vx: vx * m, vy: vy * m, rot: 0, touch: false, gone: false });
			if (!silent) sfx("shoot", -20.0, 0.1, 0.1);
		}
		function spawnPickup(r, type, x, y, vx, vy) {
			const pk = { type: type, x: x, y: y, vx: vx || 0, vy: vy || 0, scroll: r.scrollSpeed, t: R() * TAU, collected: false,
				node: 0.2, alpha: 1, magnet: magnetRadius(), sx: 1, sy: 1, rot: 0, touch: false, gone: false };
			tween(0.25, (k) => { if (!pk.collected) pk.node = lerp(0.2, 1, backOut(k)); });
			r.pickups.push(pk);
		}
		function pickupPhysics(r, pk, dt) {
			if (pk.collected) return;
			pk.t += dt;
			const p = r.player;
			let attracted = false;
			if (pk.type !== "MYSTERY" && !p.dead) {
				const dx = p.x - pk.x, dy = p.y - pk.y, l = Math.hypot(dx, dy);
				if (l < pk.magnet + p.magnetBonus) {
					attracted = true;
					const k = Math.min(12.0 * dt, 1);
					pk.vx = lerp(pk.vx, dx / (l || 1) * 1100.0, k); pk.vy = lerp(pk.vy, dy / (l || 1) * 1100.0, k);
				}
			}
			if (!attracted) { const k = Math.min(3.0 * dt, 1); pk.vx = lerp(pk.vx, 0, k); pk.vy = lerp(pk.vy, pk.scroll * 0.85, k); }
			pk.x += pk.vx * dt; pk.y += pk.vy * dt;
			if (pk.type === "COIN") { pk.sx = Math.abs(Math.cos(pk.t * 5.0)) + 0.05 / 0.55; pk.sy = 1; }
			else if (pk.type === "MYSTERY") {
				pk.x += Math.sin(pk.t * 1.5) * 90.0 * dt;
				pk.rot = Math.sin(pk.t * 7.0) * 0.18;
				pk.sx = pk.sy = 1 + 0.08 / 1.2 * Math.sin(pk.t * 9.0);
			} else pk.sx = pk.sy = 1 + 0.08 / 0.85 * Math.sin(pk.t * 8.0);
			if (pk.y > HEIGHT + 100) pk.gone = true;
		}
		function collect(r, pk, p) {
			if (pk.collected) return;
			pk.collected = true;
			if (pk.type === "COIN") { addCoins(r, 1); sfx("coin", -8.0, 0.2, 0.03); }
			else if (pk.type === "MYSTERY") openMystery(r, pk.x, pk.y);
			else { heal(p, 1); sfx("powerup", -4.0); floatText(r, "+1", pk.x, pk.y, [1.0, 0.5, 0.6], 40); }
			const n0 = pk.node;
			tween(0.18, (k) => { pk.node = lerp(n0, 1.6, k); pk.alpha = 1 - k; }, () => { pk.gone = true; });
		}

		// ------------------------------------------------------- events ---
		function runEvent(r) {
			const pool = ["SWARM", "COIN_RAIN", "GATE_RUSH"];
			const c = challenge(r);
			if (c > 1.5) pool.push("CLINGERS", "METEOR_SHOWER", "DASH_SQUAD");
			if (c > 1.8) pool.push("SHOOTER_SQUAD", "ASTEROIDS", "ROCK_WALL");
			if (c > 2.0) pool.push("SPLITTERS", "MINEFIELD");
			if (c > 2.4) pool.push("MINI_MEANIES", "ORB_CURTAIN");
			if (c > 2.6) pool.push("TANK_CONVOY");
			const ev = pick(pool);
			floatText(r, EVENT_NAMES[ev], WIDTH / 2.0, HEIGHT * 0.3, [1, 0.9, 0.5], 50);
			shake(r, 4.0);
			const w = WIDTH, inten = intensity(r);
			switch (ev) {
				case "SWARM": {
					const n = 8 + Math.floor(inten * 0.8);
					for (let i = 0; i < n; i++) spawnEnemy(r, "CIRCLE", randf(60, w - 60), -120.0 - i * 55.0, 0.45);
					break;
				}
				case "COIN_RAIN":
					for (let i = 0; i < 14; i++) spawnPickup(r, "COIN", randf(60, w - 60), -60.0 - i * 70.0);
					break;
				case "GATE_RUSH":
					for (let i = 0; i < 3; i++) spawnGatePair(r, -160.0 - i * 320.0);
					r.gateTimer = Math.max(r.gateTimer, 9.0);
					break;
				case "SHOOTER_SQUAD": {
					const row = 3 + (inten > 8.0 ? 1 : 0);
					for (let i = 0; i < row; i++) spawnEnemy(r, "RHOMBUS", 90.0 + (w - 180.0) * (i + 0.5) / row, -140.0);
					break;
				}
				case "ASTEROIDS":
					for (let i = 0; i < 4 + Math.floor(inten * 0.3); i++) spawnEnemy(r, "ROCK", randf(80, w - 80), -140.0 - i * 170.0);
					break;
				case "MINI_MEANIES":
					for (let i = 0; i < 3; i++) {
						const m = spawnEnemy(r, "BOSS", w * (0.25 + 0.25 * i), -200.0 - i * 60.0, 0.2);
						m.isMini = true; m.bodyScale = 0.9; m.scale = 0.9; m.hoverY = 200.0 + 60.0 * i;
						m.spreadCount = 3; m.leaveAfter = 22.0; m.scoreValue = Math.floor(60.0 * c); m.xpValue = 3;
					}
					break;
				case "CLINGERS":
					for (let i = 0; i < 3 + Math.floor(inten * 0.15); i++) spawnEnemy(r, "CLINGER", randf(80, w - 80), -120.0 - i * 90.0);
					break;
				case "METEOR_SHOWER":
					for (let i = 0; i < 7 + Math.floor(inten * 0.4); i++) {
						const left = R() < 0.5;
						const m = spawnEnemy(r, "METEOR", left ? -80.0 : w + 80.0, -140.0 - i * 120.0);
						let dx = left ? 1.0 : -1.0, dy = randf(0.9, 1.4); const l = Math.hypot(dx, dy), s = Math.hypot(m.vx, m.vy);
						m.vx = dx / l * s; m.vy = dy / l * s;
					}
					break;
				case "MINEFIELD": {
					const cols = 3, rows = 2 + (inten > 8.0 ? 1 : 0);
					for (let rr = 0; rr < rows; rr++) for (let ci = 0; ci < cols; ci++) {
						const even = rr % 2 === 0;
						const x = 110.0 + (w - 220.0) * (ci + (even ? 0.5 : 0.0)) / (cols - 1 + (even ? 1 : 0));
						spawnEnemy(r, "MINE", clamp(x, 90.0, w - 90.0), -140.0 - rr * 260.0);
					}
					break;
				}
				case "ROCK_WALL": {
					const slots = 5, slotW = (w - 60.0) / slots;
					for (let rr = 0; rr < 2; rr++) {
						const gap = randi(0, slots - 1);
						for (let si = 0; si < slots; si++) {
							if (si === gap) continue;
							const rock = spawnEnemy(r, "ROCK", 30.0 + slotW * (si + 0.5), -160.0 - rr * 420.0, 0.7, 0.85);
							rock.amp = 0.0; rock.speed = 20.0 * speedFactor(r);
						}
					}
					break;
				}
				case "DASH_SQUAD":
					for (let i = 0; i < 4; i++) {
						const d = spawnEnemy(r, "DASHER", 100.0 + (w - 200.0) * (i + 0.5) / 4, -120.0 - (i % 2) * 90.0);
						d.dashTimer = 0.4 + 0.35 * i;
					}
					break;
				case "SPLITTERS":
					for (let i = 0; i < 3; i++) spawnEnemy(r, "SPLITTER", w * (0.25 + 0.25 * i), -140.0 - (i % 2) * 120.0, 0.9);
					break;
				case "TANK_CONVOY":
					for (let i = 0; i < 2 + (inten > 9.0 ? 1 : 0); i++) spawnEnemy(r, "TANK", w / 2.0 + randf(-140, 140), -200.0 - i * 260.0, 0.8);
					break;
				case "ORB_CURTAIN": {
					const n = 8, spacing = (w - 80.0) / (n - 1);
					for (let rr = 0; rr < 3 + (inten > 8.0 ? 1 : 0); rr++) {
						const gap = randi(1, n - 2);
						for (let i = 0; i < n; i++) {
							if (i === gap || i === gap - 1) continue;
							spawnEnemyBullet(r, 40.0 + spacing * i, -60.0 - rr * 240.0, 0, 200.0, true);
						}
					}
					sfx("shoot", -12.0, 0.2);
					break;
				}
			}
		}

		function openMystery(r, x, y) {
			const p = r.player;
			if (r.gameOver || p.dead) return;
			let total = 0;
			MYSTERY_OUTCOMES.forEach((o) => { total += o.w; });
			let roll = randi(1, total), pk = MYSTERY_OUTCOMES[0];
			for (let i = 0; i < MYSTERY_OUTCOMES.length; i++) { roll -= MYSTERY_OUTCOMES[i].w; if (roll <= 0) { pk = MYSTERY_OUTCOMES[i]; break; } }
			const good = pk.good;
			spawnBurst(r, x, y, good ? [1, 0.95, 0.6] : [0.6, 0.4, 0.9], 1.4);
			shake(r, 6.0);
			sfx(good ? "powerup" : "gate_bad", 0.0);
			let text = "";
			switch (pk.id) {
				case "power": { const gain = Math.max(5, Math.floor(p.power * 0.5)); setPower(p, p.power + gain); text = "POWER +" + gain + "!"; break; }
				case "heart":
					if (p.hearts < p.maxHearts) { heal(p, 1); text = "+1 HEART!"; } else { raiseMaxHearts(p, 1); text = "+1 MAX HEART!"; }
					break;
				case "coins":
					for (let i = 0; i < 16; i++) { const v = fromAngle(R() * TAU, randf(200, 480)); spawnPickup(r, "COIN", x, y, v[0], v[1]); }
					text = "COIN SHOWER!";
					break;
				case "kaboom": {
					let n = 0;
					r.enemies.slice().forEach((e) => { if (e.kind !== "BOSS" && !e.dead) { takeDamage(r, e, 999999, false); n += 1; } });
					shake(r, 14.0); sfx("boom", -2.0);
					text = "KABOOM! x" + n;
					break;
				}
				case "levelup": r.xp = r.xpNext; text = "FREE LEVEL!"; r.deferLevelUp = true; break;
				case "invincible": p.invuln = Math.max(p.invuln, 5.0); text = "INVINCIBLE 5s!"; break;
				case "magnet": r.pickups.forEach((q) => { if (q.type !== "MYSTERY") q.magnet = 99999.0; }); text = "MAGNET BURST!"; break;
				case "halve": setPower(p, Math.max(1, Math.floor(p.power / 2))); text = "OOPS! POWER ÷2"; break;
				case "ouch": forceHurt(r, p); text = "OUCH! -1 HEART"; break;
				case "clingers":
					for (let i = 0; i < 3; i++) spawnEnemy(r, "CLINGER", clamp(x + (i - 1) * 110.0, 60.0, WIDTH - 60.0), y - 200.0);
					text = "CLINGERS!";
					break;
				case "slippery": p.slowTimer = Math.max(p.slowTimer, 4.0); text = "SLIPPERY! 4s"; break;
			}
			floatText(r, text, WIDTH / 2.0, HEIGHT * 0.45, good ? [1, 0.95, 0.55] : [1, 0.55, 0.65], 50);
		}

		function onEnemyKilled(r, e) {
			const c = challenge(r);
			r.kills += 1;
			const gained = e.kind === "BOSS" ? e.scoreValue : Math.floor(e.scoreValue * (0.5 + 0.5 * c));
			r.score += gained;
			r.xp += e.xpValue;
			spawnBurst(r, e.x, e.y, [1, 1, 1], e.kind === "BOSS" ? 1.6 : 0.9);
			floatText(r, "+" + gained, e.x, e.y, [1, 0.95, 0.6], 36);
			const p = r.player;
			if (e.kind === "BOSS" && !e.isMini) {
				sfx("boom", -2.0);
				shake(r, 16.0);
				for (let i = 0; i < 14 + 6 * (r.bossCount - 1); i++) { const v = fromAngle(R() * TAU, randf(250, 500)); spawnPickup(r, "COIN", e.x, e.y, v[0], v[1]); }
				if (p.hearts < p.maxHearts) spawnPickup(r, "HEART", e.x, e.y + 40);
			} else {
				sfx("pop", -6.0, 0.25, 0.04);
				shake(r, 2.5);
				let drops = 1;
				if (e.kind === "RHOMBUS" || e.kind === "ROCK" || e.kind === "SPLITTER") drops = 2;
				else if (e.kind === "TANK") drops = 4;
				if (R() < 0.5) for (let i = 0; i < drops; i++) spawnPickup(r, "COIN", e.x + randf(-20, 20), e.y, randf(-80, 80), -120);
				if (R() < 0.03 && p.hearts < p.maxHearts) spawnPickup(r, "HEART", e.x, e.y);
			}
			if (r.xp >= r.xpNext) levelUp(r);
		}
		function onEnemyLeaked(r, e) {
			const p = r.player;
			if (r.gameOver || p.dead) return;
			const cost = Math.max(1, Math.ceil(e.hp));
			drain(p, cost);
			floatText(r, "-" + cost, e.x, HEIGHT - 90.0, [1, 0.5, 0.55], 34);
			sfx("gate_bad", -10.0, 0.1, 0.15);
		}
		function addCoins(r, n) { r.runCoins += n * coinMult(); }
		function levelUp(r) {
			r.level += 1;
			r.xp -= r.xpNext;
			r.xpNext = xpNeeded(r.level);
			r.player.streamCap = bonusCap(r);
			const cap0 = bonusCap(r);
			const pool = UPGRADES.filter((u) => (r.picked[u.id] | 0) < (u.max ? Math.min(cap0, u.max) : cap0));
			if (!pool.length) { floatText(r, "LEVEL " + r.level + "!", WIDTH / 2.0, HEIGHT * 0.4, [1, 0.95, 0.6], 48); return; }
			r.options = shuffle(pool.slice()).slice(0, 3);
			r.paused = true;
			sfx("powerup", 0.0);
			showOverlay(r, "levelup", 0.2);
		}
		function chooseUpgrade(r, id) {
			const p = r.player;
			r.picked[id] = (r.picked[id] | 0) + 1;
			switch (id) {
				case "fire": p.fireRateMult += 0.2; break;
				case "dmg": p.damageBonus += 1; break;
				case "stream": p.extraStreams += 1; break;
				case "heal": if (p.hearts < p.maxHearts) heal(p, 1); else raiseMaxHearts(p, 1); break;
				case "surge": setPower(p, p.power + Math.max(15, Math.floor(p.power * 0.3))); break;
				case "pierce": p.pierce += 1; break;
				case "crit": p.critChance += 0.1; break;
				case "magnet": p.magnetBonus += 80.0; break;
				case "speed": p.bulletSpeedMult += 0.25; break;
				case "shield": p.hasShield = true; p.shieldReady = true; break;
			}
			hideOverlay(r);
			r.paused = false;
		}
		function onPlayerDied(r) {
			r.gameOver = true;
			const p = r.player;
			spawnBurst(r, p.x, p.y, [1, 0.8, 0.85], 2.2);
			shake(r, 20.0);
			sfx("gameover", 0.0, 0.0);
			audio.music(null);
			const score = Math.floor(r.score);
			const newBest = score > save.best_score;
			save.best_score = Math.max(save.best_score, score);
			save.coins += Math.floor(r.runCoins);
			r.last = { score: score, coins: Math.floor(r.runCoins), kills: r.kills, time: r.elapsed, newBest: newBest };
			persist();
			r.gameoverAt = 1.1;
			emit("gameover", r.last);
		}

		// ------------------------------------------------------------ fx ---
		function shake(r, amount) { r.shake = Math.max(r.shake, amount); }
		function spawnBurst(r, x, y, color, size, alpha) {
			const b = { kind: "burst", x: x, y: y, color: color, a0: alpha === undefined ? 1 : alpha, scale: 0.2 * size, rot: R() * TAU, alpha: 1 };
			const r0 = b.rot;
			tween(0.3, (k) => { b.scale = lerp(0.2, 1.0, k) * size; b.alpha = 1 - k; b.rot = r0 + 0.6 * k; }, () => { b.gone = true; });
			r.fx.push(b);
		}
		function floatText(r, text, x, y, color, size) {
			const f = { kind: "text", text: text, x: x, y: y, color: color, size: size, scale: 0.6, alpha: 1, dy: 0 };
			tween(0.15, (k) => { f.scale = lerp(0.6, 1, backOut(k)); });
			tween(0.8, (k) => { f.dy = -90.0 * k; });
			tween(0.8, (k) => { f.alpha = 1 - k; }, () => { f.gone = true; }, { delay: 0.3 });
			r.fx.push(f);
		}

		// ------------------------------------------------------ overlays ---
		function showOverlay(r, name, fade) {
			r.overlay = name;
			r.pressed = null;
			if (fade) tween(fade, (k) => { r.overlayAlpha = k; }, null, { ui: true });
			else r.overlayAlpha = 1;
		}
		function hideOverlay(r) { r.overlay = null; r.overlayAlpha = 1; r.pressed = null; }
		function pause(r) {
			if (!r || r.gameOver || r.paused) return;
			r.paused = true;
			showOverlay(r, "pause", 0);
		}
		function resume(r) { hideOverlay(r); r.paused = false; }

		// =================================================== physics step ===
		function physics(r, dt) {
			// game.gd _physics_process
			if (!r.gameOver) {
				r.elapsed += dt;
				r.score += dt * 6.0;
				r.scrollSpeed = 130.0 + 32.0 * (challenge(r) - 1.0) + r.elapsed * 0.25;
				r.spawnTimer -= dt;
				if (r.spawnTimer <= 0.0) { spawnWave(r); r.spawnTimer = spawnInterval(r); }
				r.gateTimer -= dt;
				if (r.gateTimer <= 0.0) { spawnGatePair(r); r.gateTimer = randf(7.5, 10.5); }
				r.bossTimer -= dt;
				if (r.bossTimer <= 0.0) { if (r.bossesAlive < MAX_BOSSES_ALIVE) spawnBoss(r); r.bossTimer = bossInterval(r); }
				r.eventTimer -= dt;
				if (r.eventTimer <= 0.0) { runEvent(r); r.eventTimer = Math.max(8.0, randf(15.0, 26.0) / (1.0 + 0.05 * intensity(r))); }
				r.mysteryTimer -= dt;
				if (r.mysteryTimer <= 0.0) { spawnPickup(r, "MYSTERY", randf(90.0, WIDTH - 90.0), -80.0); r.mysteryTimer = randf(22.0, 40.0); }
			}
			// children, in tree order
			r.gates.forEach((pair) => { pair.y += pair.scroll * dt; if (pair.y > HEIGHT + 120) pair.gone = true; });
			r.pickups.forEach((pk) => pickupPhysics(r, pk, dt));
			r.enemies.slice().forEach((e) => enemyPhysics(r, e, dt));
			r.enemyBullets.forEach((b) => {
				b.x += b.vx * dt; b.y += b.vy * dt; b.rot += 4.0 * dt;
				if (b.x < -100 || b.x > WIDTH + 100 || b.y < -200 || b.y > HEIGHT + 150) b.gone = true;
			});
			r.bullets.forEach((b) => {
				b.x += b.dx * b.speed * dt; b.y += b.dy * b.speed * dt;
				if (b.x < -100 || b.x > WIDTH + 100 || b.y < -150 || b.y > HEIGHT + 150) b.done = true;
			});
			playerPhysics(r, r.player, dt);
			r.bombs.forEach((b) => bombPhysics(r, b, dt));
			collisions(r);
			if (r.deferLevelUp) { r.deferLevelUp = false; if (!r.paused) levelUp(r); }
			r.gates = r.gates.filter((x) => !x.gone);
			r.pickups = r.pickups.filter((x) => !x.gone);
			r.enemies = r.enemies.filter((x) => !x.gone);
			r.enemyBullets = r.enemyBullets.filter((x) => !x.gone);
			r.bullets = r.bullets.filter((x) => !x.done);
			r.bombs = r.bombs.filter((x) => !x.gone);
		}
		// Area2D overlaps. "Entered" events fire once per contact, like Godot's.
		function collisions(r) {
			const p = r.player;
			// bullets -> enemies, gates
			for (let i = 0; i < r.bullets.length; i++) {
				const b = r.bullets[i];
				for (let j = 0; j < r.enemies.length && !b.done; j++) {
					const e = r.enemies[j];
					if (e.dead || e.gone || b.hit.indexOf(e) >= 0) continue;
					if (dist(b.x, b.y, e.x, e.y) > 14 + 66 * e.scale) continue;
					b.hit.push(e);
					takeDamage(r, e, b.damage, b.crit);
					if (b.pierce > 0) b.pierce -= 1; else b.done = true;
				}
				if (b.done) continue;
				r.gates.forEach((pair) => pair.gates.forEach((g) => {
					if (g.used || b.gates.indexOf(g) >= 0) return;
					if (circleRect(b.x, b.y, 14, g.x, pair.y, g.w, g.h)) { b.gates.push(g); gateBulletHit(g); }
				}));
			}
			if (p.dead) return;
			const zap = zapActive(p);
			r.enemies.slice().forEach((e) => {
				if (e.dead || e.gone) { e.touch = false; return; }
				const now = dist(e.x, e.y, p.x, p.y) < 34 + 66 * e.scale;
				if (now && !e.touch) { if (zap) takeDamage(r, e, 999999, false); else contactPlayer(r, e, p); }
				e.touch = now;
			});
			r.gates.forEach((pair) => pair.gates.forEach((g) => {
				if (g.used || p.dead) return;
				if (circleRect(p.x, p.y, 34, g.x, pair.y, g.w, g.h)) gateApply(r, pair, g, p);
			}));
			r.pickups.forEach((pk) => {
				if (pk.collected || p.dead) return;
				if (dist(pk.x, pk.y, p.x, p.y) < 34 + (pk.type === "MYSTERY" ? 44 : 28) * pk.node) collect(r, pk, p);
			});
			r.enemyBullets.forEach((b) => {
				if (b.gone || p.dead) return;
				if (dist(b.x, b.y, p.x, p.y) < 34 + 18) { b.gone = true; if (!zap) takeHit(r, p, 1); }
			});
		}
		function circleRect(cx, cy, cr, rx, ry, rw, rh) {
			const nx = clamp(cx, rx - rw / 2, rx + rw / 2), ny = clamp(cy, ry - rh / 2, ry + rh / 2);
			return dist(cx, cy, nx, ny) < cr;
		}

		// ================================================== update/draw ===
		let acc = 0;
		function update(dt) {
			dt = Math.min(dt, 0.1);
			clock += dt;
			menu.t += dt;
			if (screen === "game" && run) {
				const r = run;
				stepTweens(dt, r.paused);
				if (!r.paused) {
					acc += dt;
					while (acc >= STEP) { acc -= STEP; physics(r, STEP); if (r.paused) { acc = 0; break; } }
					// game.gd _process: screen shake
					if (r.shake > 0.0) {
						r.shake = Math.max(r.shake - dt * 40.0, 0.0);
						r.shakeX = randf(-r.shake, r.shake); r.shakeY = randf(-r.shake, r.shake);
					} else { r.shakeX = 0; r.shakeY = 0; }
					r.fx = r.fx.filter((f) => !f.gone);
				}
				if (r.gameoverAt > 0) {
					r.gameoverAt -= dt;
					if (r.gameoverAt <= 0) { r.paused = true; showOverlay(r, "gameover", 0.3); }
				}
			} else stepTweens(dt, false);
		}

		// --------------------------------------------------------- drawing --
		const tintCache = {};
		function im(name) {
			const i = images[name];
			return i && i.complete !== false && i.width ? i : null;
		}
		function tinted(name, rgb) {
			const src = im(name);
			if (!src || !rgb || typeof document === "undefined") return src;
			const key = name + "|" + rgb.join(",");
			if (tintCache[key]) return tintCache[key];
			const c = document.createElement("canvas");
			c.width = src.width; c.height = src.height;
			const x = c.getContext("2d");
			x.drawImage(src, 0, 0);
			x.globalCompositeOperation = "multiply";
			x.fillStyle = col(rgb[0], rgb[1], rgb[2]);
			x.fillRect(0, 0, c.width, c.height);
			x.globalCompositeOperation = "destination-in";
			x.drawImage(src, 0, 0);
			tintCache[key] = c;
			return c;
		}
		// Sprite2D: centred, scaled, rotated. `glow` > 0 brightens it the way a
		// modulate above 1.0 does in Godot.
		function sprite(ctx, img, x, y, sx, sy, rot, alpha, glow) {
			if (!img) return;
			ctx.save();
			ctx.translate(x, y);
			if (rot) ctx.rotate(rot);
			ctx.scale(sx, sy === undefined ? sx : sy);
			if (alpha !== undefined && alpha < 1) ctx.globalAlpha *= Math.max(alpha, 0);
			ctx.drawImage(img, -img.width / 2, -img.height / 2);
			if (glow > 0) {
				ctx.globalCompositeOperation = "lighter";
				ctx.globalAlpha *= Math.min(glow, 1);
				ctx.drawImage(img, -img.width / 2, -img.height / 2);
			}
			ctx.restore();
		}
		// a TextureRect / icon fitted into a w x h box, keep aspect, centred
		function fit(ctx, img, cx, cy, w, h, alpha) {
			if (!img) return;
			const s = Math.min(w / img.width, h / img.height);
			const a0 = ctx.globalAlpha;
			if (alpha !== undefined) ctx.globalAlpha = a0 * alpha;
			ctx.drawImage(img, cx - img.width * s / 2, cy - img.height * s / 2, img.width * s, img.height * s);
			ctx.globalAlpha = a0;
		}
		function text(ctx, s, x, y, size, color, outline, align) {
			ctx.font = size + "px " + FONT;
			ctx.textAlign = align || "center";
			ctx.textBaseline = "middle";
			if (outline) {
				ctx.lineJoin = "round";
				ctx.lineWidth = outline;
				ctx.strokeStyle = NAVY;
				ctx.strokeText(s, x, y);
			}
			ctx.fillStyle = color;
			ctx.fillText(s, x, y);
		}
		function wrap(ctx, s, size, maxW) {
			const lines = [];
			let cur = "";
			s.split(" ").forEach((w) => {
				const tryLine = cur ? cur + " " + w : w;
				if (cur && textWidth(ctx, tryLine, size) > maxW) { lines.push(cur); cur = w; } else cur = tryLine;
			});
			if (cur) lines.push(cur);
			return lines;
		}
		function textWidth(ctx, s, size) { ctx.font = size + "px " + FONT; return ctx.measureText(s).width; }
		function rrect(ctx, x, y, w, h, rad) {
			rad = Math.min(rad, w / 2, h / 2);
			ctx.beginPath();
			ctx.moveTo(x + rad, y);
			ctx.arcTo(x + w, y, x + w, y + h, rad);
			ctx.arcTo(x + w, y + h, x, y + h, rad);
			ctx.arcTo(x, y + h, x, y, rad);
			ctx.arcTo(x, y, x + w, y, rad);
			ctx.closePath();
		}
		// StyleBoxTexture with 26 px margins, drawn 1:1 at the corners
		function ninePatch(ctx, img, x, y, w, h, m) {
			if (!img) return;
			m = m || 26;
			const iw = img.width, ih = img.height;
			const xs = [[0, m, x, m], [m, iw - 2 * m, x + m, w - 2 * m], [iw - m, m, x + w - m, m]];
			const ys = [[0, m, y, m], [m, ih - 2 * m, y + m, h - 2 * m], [ih - m, m, y + h - m, m]];
			xs.forEach((cx) => ys.forEach((cy) => {
				if (cx[3] > 0 && cy[3] > 0) ctx.drawImage(img, cx[0], cy[0], cx[1], cy[1], cx[2], cy[2], cx[3], cy[3]);
			}));
		}
		// UI.button: a Kenney button with an outlined label; pressed swaps to the flat panel
		function button(ctx, b, label, size, variant, pressed, disabled) {
			const tex = disabled ? "ui/btn_grey" : pressed ? (variant === "blue" ? "ui/panel_blue" : "ui/panel_grey") : "ui/btn_" + variant;
			ninePatch(ctx, im(tex), b.x, b.y, b.w, b.h);
			const cy = b.y + b.h / 2 + (pressed ? 4 : -2);
			if (label !== null) {
				ctx.save();
				if (disabled) ctx.globalAlpha *= 0.7;
				text(ctx, label, b.x + b.w / 2 + (b.iconShift || 0), cy, size, pressed ? "rgb(230,242,255)" : "#fff", 6);
				ctx.restore();
			}
			return cy;
		}
		const inside = (b, x, y) => b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
		function panel(ctx, x, y, w, h, color, rad) { ctx.fillStyle = color; rrect(ctx, x, y, w, h, rad); ctx.fill(); }

		function drawSky(ctx) {
			// background.gd: the sky gradient (its clouds sit behind the sky polygon, so the app shows none)
			const g = ctx.createLinearGradient(0, 0, 0, HEIGHT);
			g.addColorStop(0, col(0.36, 0.68, 0.96));
			g.addColorStop(1, col(0.78, 0.92, 1.0));
			ctx.fillStyle = g;
			ctx.fillRect(-60, -60, WIDTH + 120, HEIGHT + 120);
		}

		// ------------------------------------------------------- menu ---
		const MENU = (function () {
			const pickerY = 461, rowsTop = 620;
			const ships = SHIP_COLORS.map((c, i) => ({ id: "ship:" + c, color: c, x: 110 + i * 102, y: pickerY, w: 92, h: 92 }));
			const shop = META_KEYS.map((k, i) => ({ id: "buy:" + k, key: k, x: 524, y: rowsTop + 7 + i * 68, w: 140, h: 54 }));
			return {
				ships: ships, shop: shop, rowsTop: rowsTop,
				sfx: { id: "sfx", x: 204, y: 1020, w: 150, h: 56 },
				music: { id: "music", x: 366, y: 1020, w: 150, h: 56 },
				play: { id: "play", x: 36, y: 1140, w: 648, h: 104 },
			};
		})();
		function menuButtons() { return MENU.ships.concat(MENU.shop, [MENU.sfx, MENU.music, MENU.play]); }

		function drawMenu(ctx) {
			drawSky(ctx);
			const t = menu.t;
			// buddies and hero ship bob on sine tweens
			// tween_interval(phase), up 0.9 s, down 0.9 s, and the whole sequence loops
			const bob = (y0, amp, period, phase) => {
				const tt = t % (phase + period * 2) - phase;
				if (tt < 0) return y0;
				return tt < period ? lerp(y0, y0 + amp, sineInOut(tt / period)) : lerp(y0 + amp, y0, sineInOut((tt - period) / period));
			};
			const buddy = (body, face, x, y, sc, phase) => {
				const yy = bob(y, -18, 0.9, phase);
				sprite(ctx, im("shapes/" + body), x, yy, sc);
				sprite(ctx, im("shapes/face_" + face), x, yy - 12 * sc, sc);
			};
			buddy("pink_body_circle", "k", WIDTH / 2 - 230, 360, 0.8, 0.4);
			buddy("yellow_body_square", "a", WIDTH / 2 + 230, 370, 0.75, 0.9);
			// hero: 330 -> 350 -> 310 -> 350 ... in 1.2 s legs
			let hy;
			if (t < 1.2) hy = lerp(330, 350, sineInOut(t / 1.2));
			else { const tt = (t - 1.2) % 2.4; hy = tt < 1.2 ? lerp(350, 310, sineInOut(tt / 1.2)) : lerp(310, 350, sineInOut((tt - 1.2) / 1.2)); }
			sprite(ctx, im("ufo/ship_" + save.ship_color), WIDTH / 2, hy, 1.5);

			text(ctx, "CUTE", WIDTH / 2, 79, 60, "#fff", 12);
			text(ctx, "SHOOTER", WIDTH / 2, 155, 60, "#fff", 12);

			// BEST n   coins (o)
			const bestS = "BEST " + save.best_score, coinS = String(save.coins);
			const w1 = textWidth(ctx, bestS, 26), w2 = textWidth(ctx, coinS, 26) + 6 + 36;
			const x0 = WIDTH / 2 - (w1 + 40 + w2) / 2;
			text(ctx, bestS, x0, 428, 26, "#fff", 8, "left");
			text(ctx, coinS, x0 + w1 + 40, 428, 26, "#fff", 8, "left");
			fit(ctx, im("shapes/coin"), x0 + w1 + 40 + w2 - 18, 430, 36, 36);

			MENU.ships.forEach((b) => {
				const sel = b.color === save.ship_color;
				const s = sel ? 1.15 : 1;
				fit(ctx, im("ufo/ship_" + b.color), b.x + b.w / 2, b.y + b.h / 2, b.w * s, b.h * s, sel ? 1 : 0.5);
			});

			panel(ctx, 36, 566, 648, 414, "rgba(255,255,255,0.94)", 34);
			text(ctx, "UPGRADES", WIDTH / 2, 600, 22, GREY_TEXT);
			MENU.shop.forEach((b, i) => {
				const d = META_DEFS[b.key], cy = b.y + b.h / 2;
				fit(ctx, im("icons/" + d.icon), 79, cy, 46, 46);
				text(ctx, d.name + "  " + metaLevel(b.key) + "/" + d.max, 116, cy - 11, 21, NAVY, 0, "left");
				text(ctx, d.desc, 116, cy + 17, 14, GREY_TEXT, 0, "left");
				const maxed = metaMaxed(b.key);
				const dis = maxed || !canBuy(b.key);
				const pressed = menu.pressed === b.id && !dis;
				b.iconShift = maxed ? 0 : -15;
				if (maxed) { button(ctx, b, "MAX", 18, "yellow", false, true); return; }
				const lbl = String(metaCost(b.key));
				const tw = textWidth(ctx, lbl, 18);
				const ty = button(ctx, b, lbl, 18, "yellow", pressed, dis);
				fit(ctx, im("shapes/coin"), b.x + b.w / 2 + tw / 2 - 15 + 6 + 13, ty, 26, 26, dis ? 0.7 : 1);
			});
			button(ctx, MENU.sfx, "SFX", 20, save.sfx_on ? "blue" : "grey", menu.pressed === "sfx");
			button(ctx, MENU.music, "MUSIC", 20, save.music_on ? "blue" : "grey", menu.pressed === "music");
			button(ctx, MENU.play, "PLAY", 44, "green", menu.pressed === "play");
		}
		function menuAction(id) {
			if (id === "play") { startRun(); return; }
			if (id === "sfx") { save.sfx_on = !save.sfx_on; persist(); audio.setEnabled(save.music_on, save.sfx_on); emit("settings"); return; }
			if (id === "music") { save.music_on = !save.music_on; persist(); audio.setEnabled(save.music_on, save.sfx_on); emit("settings"); return; }
			if (id.indexOf("ship:") === 0) { save.ship_color = id.slice(5); persist(); return; }
			if (id.indexOf("buy:") === 0) {
				const k = id.slice(4);
				if (canBuy(k)) { save.coins -= metaCost(k); save.meta[k] = metaLevel(k) + 1; persist(); sfx("powerup", -4.0); }
			}
		}
		function startRun() {
			screen = "game";
			run = newRun();
			acc = 0;
			audio.music("game");
			emit("screen", "game");
		}
		function toMenu() {
			screen = "menu";
			run = null;
			tweens = [];
			menu.t = 0;
			audio.music("menu");
			emit("screen", "menu");
		}

		// ------------------------------------------------------- game draw ---
		const HUD = {
			pause: { id: "pause", x: 624, y: 92, w: 76, h: 76 },
			shield: { id: "shield", x: WIDTH - 16 - ABILITY_SIZE, y: HEIGHT - 16 - ABILITY_SIZE, w: ABILITY_SIZE, h: ABILITY_SIZE },
			bomb: { id: "bomb", x: WIDTH - 16 - ABILITY_SIZE, y: HEIGHT - 16 - 2 * ABILITY_SIZE - ABILITY_GAP, w: ABILITY_SIZE, h: ABILITY_SIZE },
		};
		const abilityAnim = { bomb: { ready: true, scale: 1 }, shield: { ready: true, scale: 1 } };
		function punchAbility(id, from, dur) {
			const a = abilityAnim[id];
			tween(dur, (k) => { a.scale = lerp(from, 1, backOut(k)); }, null, { ui: true });
		}

		function drawGame(ctx, r) {
			drawSky(ctx);
			ctx.save();
			ctx.translate(r.shakeX, r.shakeY);
			// gates
			r.gates.forEach((pair) => {
				ctx.save();
				ctx.globalAlpha = pair.alpha;
				ctx.translate(0, pair.y);
				ctx.scale(pair.scale, pair.scale);
				pair.gates.forEach((g) => {
					const pos = gatePositive(g);
					panel(ctx, g.x - g.w / 2, -g.h / 2, g.w, g.h, pos ? col(0.3, 0.82, 0.45, 0.78) : col(0.96, 0.4, 0.47, 0.78), 30);
					ctx.lineWidth = 6; ctx.strokeStyle = "rgba(255,255,255,0.9)";
					rrect(ctx, g.x - g.w / 2 + 3, -g.h / 2 + 3, g.w - 6, g.h - 6, 27); ctx.stroke();
					ctx.save();
					ctx.translate(g.x, 0); ctx.scale(g.punch, g.punch);
					text(ctx, gateText(g), 0, 2, 58, "#fff", 10);
					ctx.restore();
				});
				ctx.restore();
			});
			// pickups
			r.pickups.forEach((pk) => {
				const base = pk.type === "COIN" ? 0.55 : pk.type === "HEART" ? 0.85 : 1.2;
				const tex = pk.type === "COIN" ? "shapes/coin" : pk.type === "HEART" ? "ui/heart" : "fx/present";
				sprite(ctx, im(tex), pk.x, pk.y, base * pk.sx * pk.node, base * pk.sy * pk.node, pk.rot, pk.alpha);
			});
			// enemies
			r.enemies.forEach((e) => {
				ctx.save();
				ctx.translate(e.x, e.y);
				ctx.scale(e.scale, e.scale);
				const a = e.alpha;
				const img = e.tint ? tinted(e.body, e.tint) : im(e.body);
				const glow = e.flash + e.glow;
				if (faceless(e)) sprite(ctx, img, 0, 0, e.bodySX, e.bodySX, e.bodyRot, a, glow);
				else {
					sprite(ctx, img, 0, 0, e.wob, 2 - e.wob, e.bodyRot, a, glow);
					sprite(ctx, im("shapes/face_" + e.face), 0, -12, e.wob, 2 - e.wob, 0, a);
				}
				ctx.restore();
				if (!e.dead) {
					const top = e.y + 34.0 * e.scale;
					text(ctx, String(Math.ceil(e.hp)), e.x, top + e.fontPx * 0.62, e.fontPx, "#fff", 8);
				}
			});
			// orbs
			const orb = tinted("fx/orb", [1.0, 0.55, 0.7]);
			r.enemyBullets.forEach((b) => sprite(ctx, orb, b.x, b.y, 1.15, 1.15, b.rot));
			// lasers
			r.bullets.forEach((b) => {
				const img = b.crit ? tinted("ufo/laser_" + b.color, [1.0, 0.9, 0.4]) : im("ufo/laser_" + b.color);
				const rot = Math.atan2(b.dy, b.dx) + Math.PI / 2;
				sprite(ctx, img, b.x, b.y, b.crit ? 1.0 : 0.75, b.crit ? 0.8 : 0.6, rot);
			});
			drawPlayer(ctx, r.player);
			// fx: bombs, bursts, floating text
			r.bombs.forEach((b) => {
				if (!b.exploded) { sprite(ctx, im(b.tex), b.x, b.y, 0.9 * b.scale, 0.9 * b.scale, b.rot); return; }
				const rad = BOMB_RADIUS * (1.0 - Math.pow(1.0 - b.wave, 3.0)), a = 1.0 - b.wave;
				ctx.fillStyle = col(1.0, 0.85, 0.5, 0.35 * a);
				ctx.beginPath(); ctx.arc(b.x, b.y, rad, 0, TAU); ctx.fill();
				ctx.strokeStyle = col(1.0, 0.95, 0.8, 0.95 * a); ctx.lineWidth = 4.0 + 12.0 * a;
				ctx.beginPath(); ctx.arc(b.x, b.y, rad, 0, TAU); ctx.stroke();
				ctx.strokeStyle = col(1.0, 0.6, 0.4, 0.6 * a); ctx.lineWidth = 3.0 + 6.0 * a;
				ctx.beginPath(); ctx.arc(b.x, b.y, rad * 0.7, 0, TAU); ctx.stroke();
			});
			r.fx.forEach((f) => {
				if (f.kind === "burst") sprite(ctx, tinted("fx/burst", f.color), f.x, f.y, f.scale, f.scale, f.rot, f.alpha * f.a0);
				else {
					ctx.save();
					ctx.globalAlpha = Math.max(f.alpha, 0);
					const cy = f.y - 30 + f.size * 0.65 + f.dy;
					ctx.translate(f.x, cy); ctx.scale(f.scale, f.scale);
					text(ctx, f.text, 0, 0, f.size, col(f.color[0], f.color[1], f.color[2]), 8);
					ctx.restore();
				}
			});
			ctx.restore();
			drawHud(ctx, r);
			if (r.overlay) drawOverlay(ctx, r);
		}

		function drawPlayer(ctx, p) {
			if (p.dead) return;
			ctx.save();
			ctx.translate(p.x, p.y);
			if (p.hasShield && p.shieldReady) {
				ctx.fillStyle = col(0.55, 0.9, 1.0, 0.28);
				ctx.beginPath(); ctx.arc(0, 0, 84, 0, TAU); ctx.fill();
				ctx.strokeStyle = col(0.8, 0.97, 1.0, 0.9); ctx.lineWidth = 5;
				ctx.beginPath(); ctx.arc(0, 0, 84, 0, TAU); ctx.stroke();
			}
			if (zapActive(p)) {
				const fade = clamp(p.zapTime / 0.8, 0.0, 1.0);
				const rad = ZAP_SHIELD_RADIUS * (1.0 + 0.03 * Math.sin(p.bob * 5.0)) * (0.6 + 0.4 * fade);
				ctx.fillStyle = col(1.0, 0.75, 0.35, 0.22 * fade);
				ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU); ctx.fill();
				ctx.strokeStyle = col(1.0, 0.92, 0.55, 0.95 * fade); ctx.lineWidth = 7;
				ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU); ctx.stroke();
				ctx.strokeStyle = col(1.0, 1.0, 0.8, 0.8 * fade); ctx.lineWidth = 4; ctx.lineCap = "round";
				for (let i = 0; i < 14; i++) {
					const a0 = p.bob * 1.5 + TAU * i / 14;
					ctx.beginPath(); ctx.arc(0, 0, rad + 12.0, a0, a0 + TAU / 14 * 0.45); ctx.stroke();
				}
			}
			const mini = im("ufo/mini_" + p.color);
			p.dyingMinis.concat(p.minis).forEach((m) => sprite(ctx, mini, m.x, m.y, m.scale, m.scale, m.rot));
			if (p.shipVisible) sprite(ctx, im("ufo/ship_" + p.color), 0, p.shipY, p.shipSX, p.shipSY, p.shipRot);
			ctx.translate(0, -122);
			ctx.scale(p.labelScale, p.labelScale);
			text(ctx, String(p.power), 0, 0, 44, "#fff", 10);
			ctx.restore();
		}

		function drawHud(ctx, r) {
			const p = r.player;
			// XP bar
			panel(ctx, 20, 10, 680, 40, "rgba(255,255,255,0.5)", 12);
			const frac = clamp(r.xp / r.xpNext, 0, 1);
			if (frac > 0) {
				ctx.save();
				rrect(ctx, 20, 10, 680, 40, 12); ctx.clip();
				panel(ctx, 20, 10, Math.max(680 * frac, 24), 40, col(1.0, 0.85, 0.3), 12);
				ctx.restore();
			}
			const heart = im("ui/heart"), empty = tinted("ui/heart", [0.2, 0.2, 0.3]);
			for (let i = 0; i < p.maxHearts; i++) {
				if (i < p.hearts) fit(ctx, heart, 20 + i * 50 + 24, 64, 48, 48);
				else fit(ctx, empty, 20 + i * 50 + 24, 64, 48, 48, 0.45);
			}
			text(ctx, "LV " + r.level, 24, 106, 22, col(1, 0.92, 0.55), 6, "left");
			text(ctx, String(Math.floor(r.score)), WIDTH / 2, 93, 56, "#fff", 10);
			text(ctx, "BEST " + save.best_score, WIDTH / 2, 140, 22, "rgba(255,255,255,0.85)", 5);
			const coins = String(Math.floor(r.runCoins));
			const cw = textWidth(ctx, coins, 32);
			text(ctx, coins, 500, 61, 32, "#fff", 8, "left");
			fit(ctx, im("shapes/coin"), 500 + cw + 6 + 20, 62, 40, 40);
			button(ctx, HUD.pause, "II", 30, "blue", r.pressed === "pause" && !r.overlay);
			drawAbility(ctx, "shield", HUD.shield, "icons/shield_gold", "green", p.zapCd, ZAP_SHIELD_COOLDOWN, p.zapTime, ZAP_SHIELD_DURATION);
			drawAbility(ctx, "bomb", HUD.bomb, "fx/bomb", "yellow", p.bombCd, BOMB_COOLDOWN, 0, 1);
		}
		function drawAbility(ctx, id, b, icon, color, cd, cdTotal, active, activeTotal) {
			const st = abilityAnim[id];
			let frac = 0, pie = null, secs = 0, tint = null;
			if (active > 0) { frac = active / activeTotal; pie = "rgba(255,217,77,0.55)"; secs = Math.ceil(active); }
			else if (cd > 0) { frac = cd / cdTotal; pie = "rgba(26,31,64,0.6)"; secs = Math.ceil(cd); tint = [0.6, 0.6, 0.68]; }
			const ready = !pie;
			if (ready && !st.ready) punchAbility(id, 1.12, 0.3);
			st.ready = ready;
			ctx.save();
			ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
			ctx.scale(st.scale, st.scale);
			ctx.translate(-b.w / 2, -b.h / 2);
			const base = tint ? tinted("ui/btn_round_" + color, tint) : im("ui/btn_round_" + color);
			if (base) ctx.drawImage(base, 0, 0, b.w, b.h);
			const iconSize = ABILITY_SIZE * 0.5;
			fit(ctx, im(icon), b.w / 2, b.h * 0.47, iconSize, iconSize, ready ? 1 : 0.35);
			if (pie) {
				const cx = b.w / 2, cy = b.h * 0.47, rad = b.w * 0.46;
				ctx.fillStyle = pie;
				ctx.beginPath(); ctx.moveTo(cx, cy);
				ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(frac, 0, 1));
				ctx.closePath(); ctx.fill();
				text(ctx, String(secs), b.w / 2, b.h * 0.47, 30, "#fff", 8);
			}
			ctx.restore();
		}

		// overlays.gd layouts: a centred VBox of fixed-height rows, 16 px apart
		function vbox(rows, sep) {
			let total = 0;
			rows.forEach((h, i) => { total += h + (i ? sep : 0); });
			let y = (HEIGHT - total) / 2;
			return rows.map((h) => { const top = y; y += h + sep; return top; });
		}
		const LEVELUP = (function () {
			const tops = vbox([80, 38, 10, 486], 16);
			const cards = [0, 1, 2].map((i) => ({ id: "card" + i, i: i, x: 40, y: tops[3] + i * 168, w: 640, h: 150 }));
			return { titleY: tops[0] + 40, subY: tops[1] + 19, cards: cards };
		})();
		const PAUSE = (function () {
			const tops = vbox([80, 110, 90, 90], 16);
			return {
				titleY: tops[0] + 40,
				resume: { id: "resume", x: 100, y: tops[1], w: 520, h: 110 },
				sfx: { id: "psfx", x: 100, y: tops[2], w: 252, h: 90 },
				music: { id: "pmusic", x: 368, y: tops[2], w: 252, h: 90 },
				quit: { id: "quit", x: 100, y: tops[3], w: 520, h: 90 },
			};
		})();
		const GAMEOVER = (function () {
			const tops = vbox([90, 275, 116, 90], 16);
			return {
				titleY: tops[0] + 45, panelY: tops[1],
				retry: { id: "retry", x: 60, y: tops[2], w: 600, h: 116 },
				menu: { id: "menu", x: 60, y: tops[3], w: 600, h: 90 },
			};
		})();
		function overlayButtons(r) {
			if (r.overlay === "levelup") return LEVELUP.cards.slice(0, r.options.length);
			if (r.overlay === "pause") return [PAUSE.resume, PAUSE.sfx, PAUSE.music, PAUSE.quit];
			if (r.overlay === "gameover") return [GAMEOVER.retry, GAMEOVER.menu];
			return [];
		}
		function drawOverlay(ctx, r) {
			ctx.fillStyle = col(0.08, 0.12, 0.28, 0.6);
			ctx.fillRect(0, 0, WIDTH, HEIGHT);
			ctx.save();
			ctx.globalAlpha = r.overlayAlpha;
			if (r.overlay === "levelup") {
				text(ctx, "LEVEL UP!", WIDTH / 2, LEVELUP.titleY, 64, col(1, 0.92, 0.45), 12);
				text(ctx, "Pick an upgrade", WIDTH / 2, LEVELUP.subY, 30, "#fff", 6);
				r.options.forEach((u, i) => {
					const b = LEVELUP.cards[i], pressed = r.pressed === b.id;
					panel(ctx, b.x, b.y, b.w, b.h, pressed ? col(0.9, 0.95, 1.0, 0.98) : "rgba(255,255,255,0.96)", 30);
					if (pressed) { ctx.strokeStyle = col(SKY[0], SKY[1], SKY[2]); ctx.lineWidth = 6; rrect(ctx, b.x + 3, b.y + 3, b.w - 6, b.h - 6, 27); ctx.stroke(); }
					fit(ctx, im(u.icon === "heart" ? "ui/heart" : "icons/" + u.icon), b.x + 24 + 48, b.y + b.h / 2, 96, 96);
					// name + autowrapped description, centred as one block like the VBox
					const lines = wrap(ctx, u.desc, 24, b.w - 142 - 24);
					const top = b.y + b.h / 2 - (44 + 4 + lines.length * 30) / 2;
					text(ctx, u.name, b.x + 142, top + 22, 36, NAVY, 0, "left");
					lines.forEach((ln, li) => text(ctx, ln, b.x + 142, top + 48 + 15 + li * 30, 24, GREY_TEXT, 0, "left"));
					text(ctx, String(i + 1), b.x + b.w - 30, b.y + 26, 18, "rgba(89,102,140,0.5)", 0);
				});
			} else if (r.overlay === "pause") {
				text(ctx, "PAUSED", WIDTH / 2, PAUSE.titleY, 64, "#fff", 12);
				button(ctx, PAUSE.resume, "RESUME", 40, "green", r.pressed === "resume");
				button(ctx, PAUSE.sfx, save.sfx_on ? "SFX: ON" : "SFX: OFF", 28, save.sfx_on ? "blue" : "grey", r.pressed === "psfx");
				button(ctx, PAUSE.music, save.music_on ? "MUSIC: ON" : "MUSIC: OFF", 28, save.music_on ? "blue" : "grey", r.pressed === "pmusic");
				button(ctx, PAUSE.quit, "QUIT TO MENU", 30, "red", r.pressed === "quit");
			} else if (r.overlay === "gameover") {
				const last = r.last;
				text(ctx, "OH NO!", WIDTH / 2, GAMEOVER.titleY, 72, col(1, 0.6, 0.65), 14);
				const py = GAMEOVER.panelY;
				panel(ctx, 60, py, 600, 275, "rgba(255,255,255,0.94)", 34);
				text(ctx, "SCORE", WIDTH / 2, py + 20 + 15, 24, GREY_TEXT);
				text(ctx, String(last.score), WIDTH / 2, py + 56 + 40, 64, NAVY);
				text(ctx, last.newBest ? "NEW BEST!" : "BEST " + save.best_score, WIDTH / 2, py + 142 + 16, 26, last.newBest ? col(0.95, 0.55, 0.15) : GREY_TEXT);
				text(ctx, "+" + last.coins + " coins", WIDTH / 2, py + 181 + 19, 30, col(0.85, 0.6, 0.1));
				const tt = Math.floor(last.time);
				text(ctx, last.kills + " kills  ·  " + Math.floor(tt / 60) + ":" + String(tt % 60).padStart(2, "0"), WIDTH / 2, py + 225 + 15, 24, GREY_TEXT);
				button(ctx, GAMEOVER.retry, "PLAY AGAIN", 40, "green", r.pressed === "retry");
				button(ctx, GAMEOVER.menu, "MENU", 32, "blue", r.pressed === "menu");
			}
			ctx.restore();
		}
		function overlayAction(r, id) {
			if (id.indexOf("card") === 0) {
				const u = r.options[+id.slice(4)];
				if (u) { sfx("powerup", -2.0); chooseUpgrade(r, u.id); }
				return;
			}
			switch (id) {
				case "resume": resume(r); break;
				case "psfx": save.sfx_on = !save.sfx_on; persist(); audio.setEnabled(save.music_on, save.sfx_on); emit("settings"); break;
				case "pmusic": save.music_on = !save.music_on; persist(); audio.setEnabled(save.music_on, save.sfx_on); emit("settings"); break;
				case "quit": case "menu": toMenu(); break;
				case "retry": startRun(); break;
			}
		}

		function draw(ctx) {
			ctx.save();
			if (screen === "menu") drawMenu(ctx);
			else drawGame(ctx, run);
			ctx.restore();
		}

		// ---------------------------------------------------------- input ---
		// Points are in game units (0..720, 0..1280).
		let dragId = null, lastX = 0;
		function pointerDown(x, y, id) {
			audio.unlock();
			if (screen === "menu") {
				const b = menuButtons().find((bb) => inside(bb, x, y));
				menu.pressed = b ? b.id : null;
				return;
			}
			const r = run;
			if (r.overlay) {
				const b = overlayButtons(r).find((bb) => inside(bb, x, y));
				r.pressed = b ? b.id : null;
				return;
			}
			if (r.paused) return;
			// Round ability buttons fire on press, like hud.gd's AbilityButton.
			if (!r.gameOver && inside(HUD.bomb, x, y)) {
				if (r.player.bombCd <= 0 && !r.player.dead) { click(); punchAbility("bomb", 0.88, 0.2); useBomb(r); }
				return;
			}
			if (!r.gameOver && inside(HUD.shield, x, y)) {
				if (r.player.zapCd <= 0 && !r.player.dead) { click(); punchAbility("shield", 0.88, 0.2); useZapShield(r); }
				return;
			}
			if (inside(HUD.pause, x, y)) { r.pressed = "pause"; return; }
			dragId = id; lastX = x;
		}
		function pointerMove(x, y, id) {
			if (screen !== "game" || dragId === null || id !== dragId) return;
			const r = run;
			const dx = x - lastX;
			lastX = x;
			if (r.gameOver || r.paused) return;
			r.player.targetX += dx * 1.25;
		}
		function pointerUp(x, y, id) {
			if (id === dragId) dragId = null;
			if (screen === "menu") {
				const b = menuButtons().find((bb) => inside(bb, x, y));
				if (b && b.id === menu.pressed) {
					const isShip = b.id.indexOf("ship:") === 0;
					const isBuy = b.id.indexOf("buy:") === 0;
					if (!isShip && !(isBuy && !canBuy(b.key))) click();
					menuAction(b.id);
				}
				menu.pressed = null;
				return;
			}
			const r = run;
			const pid = r.pressed;
			r.pressed = null;
			if (!pid) return;
			if (r.overlay) {
				const b = overlayButtons(r).find((bb) => inside(bb, x, y));
				if (b && b.id === pid) { if (pid.indexOf("card") !== 0) click(); overlayAction(r, pid); }
				return;
			}
			if (pid === "pause" && inside(HUD.pause, x, y)) { click(); pause(r); }
		}
		function key(code, down) {
			if (down) audio.unlock();
			if (screen === "menu") {
				if (down && (code === "Enter" || code === "Space")) { click(); startRun(); return true; }
				return false;
			}
			const r = run;
			if (code === "ArrowLeft" || code === "KeyA") { r.keys.left = down; return true; }
			if (code === "ArrowRight" || code === "KeyD") { r.keys.right = down; return true; }
			if (!down) return false;
			if (r.overlay === "levelup") {
				const n = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[code];
				if (n !== undefined && r.options[n]) { overlayAction(r, "card" + n); return true; }
				return false;
			}
			if (r.overlay === "pause") {
				if (code === "Escape" || code === "KeyP" || code === "Enter") { click(); resume(r); return true; }
				return false;
			}
			if (r.overlay === "gameover") {
				if (code === "Enter" || code === "Space") { click(); startRun(); return true; }
				if (code === "Escape") { click(); toMenu(); return true; }
				return false;
			}
			if (r.paused || r.gameOver) return false;
			if (code === "Space" || code === "KeyZ") { if (r.player.bombCd <= 0) punchAbility("bomb", 0.88, 0.2); useBomb(r); return true; }
			if (code === "ShiftLeft" || code === "ShiftRight" || code === "KeyX") { if (r.player.zapCd <= 0) punchAbility("shield", 0.88, 0.2); useZapShield(r); return true; }
			if (code === "Escape" || code === "KeyP") { click(); pause(r); return true; }
			return false;
		}
		// The window lost focus or the tab was hidden: pause, as the app does on
		// NOTIFICATION_APPLICATION_PAUSED. Also let go of held keys.
		function blur() {
			if (screen === "game" && run) { run.keys.left = run.keys.right = false; pause(run); }
			dragId = null;
		}

		audio.music("menu");

		return {
			update: update, draw: draw, pointerDown: pointerDown, pointerMove: pointerMove, pointerUp: pointerUp,
			key: key, blur: blur,
			on(name, f) { (listeners[name] = listeners[name] || []).push(f); },
			get screen() { return screen; },
			get run() { return run; },
			get save() { return save; },
			setAudio(music, sound) { save.music_on = !!music; save.sfx_on = !!sound; persist(); audio.setEnabled(save.music_on, save.sfx_on); emit("settings"); },
			startRun: startRun, toMenu: toMenu,
			// for tests and the console
			debug: { challenge: () => run && challenge(run), intensity: () => run && intensity(run), spawnEnemy: (k, x, y) => run && spawnEnemy(run, k, x, y), useBomb: () => run && useBomb(run), useZapShield: () => run && useZapShield(run), runEvent: () => run && runEvent(run), openMystery: () => run && openMystery(run, 360, 600), levelUp: () => run && levelUp(run), chooseUpgrade: (id) => run && chooseUpgrade(run, id), menuAction: menuAction, overlayAction: (id) => run && overlayAction(run, id) },
		};
	}

	// -------------------------------------------------------------- mount --
	function mount(canvas, opts) {
		opts = opts || {};
		const base = opts.base || "";
		let storage;
		try { storage = window.localStorage; storage.getItem("x"); } catch (e) { storage = null; }
		const images = {};
		IMAGES.forEach((n) => { const i = new Image(); i.src = base + "img/" + n + ".png"; images[n] = i; });
		const game = create({ audio: opts.audio, images: images, storage: storage || undefined });
		const ctx = canvas.getContext("2d");

		function resize() {
			const rect = canvas.getBoundingClientRect();
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
			if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
		}
		function toGame(e) {
			const rect = canvas.getBoundingClientRect();
			return [(e.clientX - rect.left) / rect.width * WIDTH, (e.clientY - rect.top) / rect.height * HEIGHT];
		}
		canvas.addEventListener("pointerdown", (e) => {
			if (e.pointerType === "mouse" && e.button !== 0) return;
			e.preventDefault();
			canvas.focus({ preventScroll: true });
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
			const p = toGame(e); game.pointerDown(p[0], p[1], e.pointerId);
		});
		canvas.addEventListener("pointermove", (e) => { const p = toGame(e); game.pointerMove(p[0], p[1], e.pointerId); });
		canvas.addEventListener("pointerup", (e) => { const p = toGame(e); game.pointerUp(p[0], p[1], e.pointerId); });
		canvas.addEventListener("pointercancel", (e) => { game.pointerUp(-1, -1, e.pointerId); });
		canvas.addEventListener("contextmenu", (e) => e.preventDefault());
		canvas.addEventListener("keydown", (e) => { if (e.repeat && e.code !== "ArrowLeft" && e.code !== "ArrowRight") { if (e.code === "Space") e.preventDefault(); return; } if (game.key(e.code, true)) e.preventDefault(); });
		canvas.addEventListener("keyup", (e) => { game.key(e.code, false); });
		canvas.addEventListener("blur", () => game.blur());
		window.addEventListener("blur", () => game.blur());
		document.addEventListener("visibilitychange", () => { if (document.hidden) game.blur(); });

		function render() {
			resize();
			ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
			game.draw(ctx);
		}
		let last = null;
		function frame(now) {
			const dt = last === null ? 0 : (now - last) / 1000;
			last = now;
			game.update(dt);
			render();
			requestAnimationFrame(frame);
		}
		requestAnimationFrame(frame);
		game.render = render;
		return game;
	}

	return { WIDTH, HEIGHT, IMAGES, create, mount };
});
