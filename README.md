# Cute Shooter — website

The landing page for the Android game in `../cute-shooter`: the game itself,
playable in the browser, plus a short how-it-plays, the cast of enemies, the
two abilities, screenshots, an about section, the privacy policy Google Play
requires, the terms and conditions, and a download call to action.

Plain static files, no build step, no third-party requests (fonts are
self-hosted).

```
index.html            landing page: hero with the live game, how it plays, cuties, abilities, shots, about, CTA
privacy/index.html    privacy policy, served at /privacy (link this URL in Play Console)
terms/index.html      terms and conditions, served at /terms (see "Terms and conditions")
terms/YYYY-MM-DD.html past versions of the terms, named by the date they took effect (none yet)
404.html              not-found page
style.css             one stylesheet for every page
game.js               the game, a port of the Godot scenes to canvas
audio.js              Web Audio layer: sound effects and the two music loops
test/soak.js          headless soak test of game.js (see below)
tools/og-card.html    source of img/og.png (see SEO)
tools/terms.mjs       keeps the terms versions consistent (see "Terms and conditions")
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
the home page, the privacy policy and the current terms, with the share card, screenshots and icon as image entries on
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

## Terms and conditions

`terms/index.html` is the version of the terms in effect, at
`https://cute-shooter.com/terms/`. Every earlier version stays online as
`terms/<YYYY-MM-DD>.html`, named by the date it took effect, `noindex`, with
no canonical or `og:url` and an "old version" note at the top, and the
"Changes and past versions" table at the bottom of the current page links
each one. Old versions are never deleted or edited.

```sh
node tools/terms.mjs list                                     # effective date and versions
node tools/terms.mjs new cute-shooter 2027-03-01 "What changed"
node tools/terms.mjs check                                    # run before every deploy
```

Never edit a live version in place. To change the terms, run `new` with the
date the new wording takes effect: it archives the current page as
`terms/<old date>.html`, moves `index.html` to the new date, adds a row on
top of its versions table and bumps the `lastmod` in `sitemap.xml`. Then
edit `terms/index.html` with the new wording and run `check`, which fails on
any inconsistency (dates, table, archives, noindex, sitemap). Keep the
markers the tool relies on: `<time class="effective">`, the
`<!-- archived-notice -->` comment and `<tbody data-versions>` with one
`<tr data-current>` row.

Give `https://cute-shooter.com/terms/` to the stores: Play Console (store
listing, and the trader declaration under the EU Digital Services Act) and,
if the game ever comes to iPhone, App Store Connect.

Before going live: fill in the four placeholders in `terms/index.html`,
`[[TRADER_NAME]]`, `[[TRADER_ADDRESS]]`, `[[TRADER_REGISTRATION]]` and
`[[CONSUMER_MEDIATOR]]`, with the details declared to Google Play; `check`
fails until they are gone. As long as no archived version exists, the
effective date (14 November 2026, in the `<time class="effective">` and in
the versions table row) may be moved by hand to the real date of first
publication, together with the terms' `lastmod` in `sitemap.xml`.

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
- Give `https://cute-shooter.com/terms/` as the terms and conditions URL (see
  "Terms and conditions"), once its placeholders are filled in.
- The Google Play buttons point at
  `https://play.google.com/store/apps/details?id=com.eiilo.games.cuteshooter`, which 404s until
  the app is published.
