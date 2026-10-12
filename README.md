# Cute Shooter — website

The landing page for the Android game in `../cute-shooter`: the game itself,
playable in the browser, plus a short how-it-plays, the cast of enemies, the
two abilities, screenshots, an about section, the privacy policy Google Play
requires, and a download call to action.

Plain static files, no build step, no third-party requests (fonts are
self-hosted).

```
index.html            landing page: hero with the live game, how it plays, cuties, abilities, shots, about, CTA
privacy/index.html    privacy policy, served at /privacy (link this URL in Play Console)
404.html              not-found page
style.css             one stylesheet for every page
game.js               the game, a port of the Godot scenes to canvas
audio.js              Web Audio layer: sound effects and the two music loops
test/soak.js          headless soak test of game.js (see below)
tools/og-card.html    source of img/og.png (see SEO)
img/                  sprites from the game, the app icon, screenshots, og.png (1200x630 share card)
sfx/, music/          the game's audio, .ogg plus an .m4a copy for Safari
fonts/                Kenney Bold / Mini Square / Future (CC0), Atkinson Hyperlegible (OFL)
app-ads.txt           AdMob authorised-seller line (same eiilo publisher as the other games)
favicon.png, apple-touch-icon.png, robots.txt, sitemap.xml, CNAME, .nojekyll
```

## Run locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

Links are root-absolute (`/privacy`, `/img/...`), so the site must be served
from the root of a domain, and over HTTP(S), not opened as a file (the audio
is fetched).

## The browser game

`game.js` ports `main_menu.gd`, `game.gd`, `player.gd`, `enemy.gd`,
`gate.gd`, `bullet.gd`, `pickup.gd`, `bomb.gd`, `hud.gd`, `overlays.gd` and
`game_state.gd`. It keeps the game's 720x1280 coordinate space and 60 Hz
physics step, so every constant is the same number as in the GDScript; when
you change a balance number in the game, change it here too.

The browser build shows no ads and saves to `localStorage`
(`cute-shooter-save`). `window.CuteGame` is exposed for the console; in a
hidden tab `requestAnimationFrame` does not run, so drive it by hand with
`CuteGame.update(dt); CuteGame.render()`.

```sh
node test/soak.js [minutes-per-run]   # must print OK
```

The soak test runs the real game on a stub canvas with a seeded RNG: a bot
plays several runs, every event and mystery-box outcome is forced, and the
menu, shop, pause, game-over and save paths are checked.

## SEO

Every indexable page has a title, description, canonical URL, Open Graph
and Twitter card tags. The home page also has JSON-LD (`WebSite`,
`Organization`, and a `VideoGame` + `MobileApplication` for the game); keep
its description and screenshots in step with the page. `sitemap.xml` lists
both pages, with the share card, screenshots and icon as image entries on
the home page; bump a page's `lastmod` when you change it. `404.html` is
`noindex`.

The share card `img/og.png` (1200x630 PNG) is `tools/og-card.html` rendered
by headless Chromium. Edit the HTML, then, with the local server from "Run
locally" running:

```sh
chromium --headless --disable-gpu --hide-scrollbars --window-size=1200,630 \
  --virtual-time-budget=3000 --screenshot=/tmp/og.png http://localhost:8000/tools/og-card.html
magick /tmp/og.png -strip -define png:compression-level=9 img/og.png
```

Look at the result before committing; social sites cache the old card, so
re-scrape it with Facebook's Sharing Debugger after deploy.

## Deploy

GitHub Pages, no build step: what is in `main` is what is served.

1. Push to a public repository `eiilo-games/cute-shooter-landing-page`.
2. Settings > Pages > Build and deployment: Source "Deploy from a branch",
   branch `main`, folder `/ (root)`.
3. Custom domain: `cute-shooter.com` (already in `CNAME`). Once the DNS below
   resolves and the certificate is issued, tick **Enforce HTTPS**.
4. Verify the domain for the organisation, so no other GitHub account can
   claim it: org Settings > Pages > Verified domains > Add a domain, then
   add the `_github-pages-challenge-eiilo-games` TXT record it shows at
   OVH and click Verify.

DNS at OVH (Web Cloud > Domain names > `cute-shooter.com` > DNS zone):

| Host  | Type  | Target                   |
|-------|-------|--------------------------|
| (apex)| A     | `185.199.108.153`        |
| (apex)| A     | `185.199.109.153`        |
| (apex)| A     | `185.199.110.153`        |
| (apex)| A     | `185.199.111.153`        |
| (apex)| AAAA  | `2606:50c0:8000::153`    |
| (apex)| AAAA  | `2606:50c0:8001::153`    |
| (apex)| AAAA  | `2606:50c0:8002::153`    |
| (apex)| AAAA  | `2606:50c0:8003::153`    |
| `www` | CNAME | `eiilo-games.github.io.` |

Delete OVH's default apex A record (`213.186.33.5`) and any default `www`
record (A, AAAA or CNAME) first; leftovers break the certificate. GitHub
redirects `www.cute-shooter.com` to the apex.

After it is live:

- In Play Console set the developer website to `https://cute-shooter.com` (AdMob
  only checks `https://cute-shooter.com/app-ads.txt`, at the root) and the privacy
  policy to `https://cute-shooter.com/privacy/`; use the same URL in AdMob and keep the Data
  safety form in line with the policy.
- The Google Play buttons point at
  `https://play.google.com/store/apps/details?id=com.eiilo.games.cuteshooter`, which 404s until
  the app is published.
