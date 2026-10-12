/* Cute Shooter, browser edition: the Web Audio layer.
 *
 * game.js never touches audio itself. It calls the adapter created here,
 * which mirrors the game's Audio autoload (scripts/audio.gd):
 *
 *   unlock()                    first user gesture: create / resume the context
 *   setEnabled(music, sound)    the two switches (booleans)
 *   play(name, db, pitchVar)    one of the clips in sfx/, randomly pitched
 *   music(name)                 "menu", "game" or null; loops, at -9 dB
 *
 * Every clip ships as OGG Vorbis with an AAC (.m4a) copy for Safari, which
 * cannot decode Vorbis.
 */
(function (root) {
	"use strict";

	const SFX = ["shoot", "hit", "pop", "boom", "gate_good", "gate_bad", "powerup", "coin", "hurt", "gameover", "click"];
	const MUSIC = { menu: "cheerful", game: "space_cadet" };
	const MUSIC_DB = -9;
	const MAX_VOICES = 12;   // Audio.POOL_SIZE
	const db = (v) => Math.pow(10, v / 20);

	function create(opts) {
		opts = opts || {};
		const base = opts.base || "";
		const AC = root.AudioContext || root.webkitAudioContext;
		let ctx = null, musicGain = null, sfxGain = null;
		let musicOn = true, soundOn = true;
		let want = null, current = null;   // music track names
		let musicSrc = null;
		const voices = [];
		const raw = {}, buffers = {};

		const oggOk = (function () {
			try { return !!document.createElement("audio").canPlayType('audio/ogg; codecs="vorbis"'); } catch (e) { return false; }
		})();
		const url = (dir, name, forceM4a) => base + dir + "/" + name + (oggOk && !forceM4a ? ".ogg" : ".m4a");

		function ensureCtx() {
			if (ctx || !AC) return ctx;
			ctx = new AC({ latencyHint: "interactive" });
			musicGain = ctx.createGain(); musicGain.connect(ctx.destination);
			sfxGain = ctx.createGain(); sfxGain.connect(ctx.destination);
			apply();
			return ctx;
		}
		function apply() {
			if (!ctx) return;
			musicGain.gain.value = musicOn ? db(MUSIC_DB) : 0;
			sfxGain.gain.value = soundOn ? 1 : 0;
		}
		function fetchRaw(u) {
			if (!raw[u]) raw[u] = fetch(u).then((r) => {
				if (!r.ok) throw new Error("HTTP " + r.status + " for " + u);
				return r.arrayBuffer();
			});
			return raw[u];
		}
		function decodeUrl(u) {
			if (!buffers[u]) {
				buffers[u] = fetchRaw(u).then((ab) => new Promise((res, rej) => {
					// Safari's decodeAudioData is callback-only
					const p = ctx.decodeAudioData(ab.slice(0), res, rej);
					if (p && p.then) p.then(res, rej);
				}));
				buffers[u].catch(() => { delete buffers[u]; });
			}
			return buffers[u];
		}
		function load(dir, name) {
			return decodeUrl(url(dir, name)).catch((err) => {
				if (!oggOk) throw err;
				return decodeUrl(url(dir, name, true));
			});
		}
		// Warm the files up front; they decode once a context exists.
		SFX.forEach((n) => fetchRaw(url("sfx", n)).catch(() => {}));

		const ready = {};   // name -> AudioBuffer, so play() can be synchronous
		function warm() {
			SFX.forEach((n) => { if (!ready[n]) load("sfx", n).then((b) => { ready[n] = b; }, () => {}); });
		}

		function startMusic() {
			if (!ctx || want === current) return;
			if (musicSrc) { try { musicSrc.stop(); } catch (e) { /* already stopped */ } musicSrc.disconnect(); musicSrc = null; }
			current = want;
			if (!want) return;
			const name = want;
			load("music", MUSIC[name]).then((buf) => {
				if (current !== name || musicSrc) return;
				musicSrc = ctx.createBufferSource();
				musicSrc.buffer = buf;
				musicSrc.loop = true;
				musicSrc.connect(musicGain);
				musicSrc.start();
			}, () => {});
		}

		return {
			unlock() {
				if (!ensureCtx()) return;
				if (ctx.state === "suspended") ctx.resume();
				warm();
				startMusic();
			},
			setEnabled(music, sound) {
				musicOn = !!music; soundOn = !!sound;
				apply();
			},
			play(name, volumeDb, pitchVar) {
				if (!ctx || !soundOn || ctx.state !== "running") return;
				const buf = ready[name];
				if (!buf) return;
				// Same voice cap as the Godot pool: steal the oldest when full.
				if (voices.length >= MAX_VOICES) { const v = voices.shift(); try { v.stop(); } catch (e) { /* done */ } }
				const src = ctx.createBufferSource();
				const g = ctx.createGain();
				src.buffer = buf;
				const pv = pitchVar === undefined ? 0.08 : pitchVar;
				src.playbackRate.value = 1 - pv + Math.random() * 2 * pv;
				g.gain.value = db(volumeDb || 0);
				src.connect(g); g.connect(sfxGain);
				src.onended = () => { const i = voices.indexOf(src); if (i >= 0) voices.splice(i, 1); g.disconnect(); };
				voices.push(src);
				src.start();
			},
			music(name) {
				want = name || null;
				startMusic();
			},
		};
	}

	root.CuteAudio = { create };
})(typeof self !== "undefined" ? self : this);
