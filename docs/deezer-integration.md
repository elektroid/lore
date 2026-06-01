# Deezer playback integration

Research on piloting Deezer from within Lore.

## How the SDK works

Deezer provides an official JavaScript SDK that embeds an **invisible iframe** in the page. The iframe streams audio through the Deezer player engine — no visible widget, full programmatic control.

### Initialisation

```js
DZ.init({
  appId: 'YOUR_APP_ID',
  channelUrl: 'https://yourdomain/channel.html',
  player: {
    onload: function() { /* SDK ready */ }
  }
})
```

`channel.html` is a tiny static file that must be served from the same domain as the app. Its only content:

```html
<script src="https://e-cdns-files.dzcdn.net/js/min/dz.js"></script>
```

The SDK uses it for cross-origin iframe messaging.

### OAuth login

```js
DZ.login(function(response) {
  if (response.authResponse) { /* logged in */ }
}, { perms: 'basic_access,listening_history' })
```

Opens a Deezer popup. The user authorises once; the SDK caches the token. No client secret is involved — `appId` being public in frontend code is normal.

### Playback API

```js
DZ.player.playPlaylist(playlistId)  // numeric ID only, not the full URL
DZ.player.play()
DZ.player.pause()
DZ.player.next()
DZ.player.prev()
DZ.player.setVolume(70)             // 0–100
```

The playlist ID must be extracted from the stored URL:

```
https://www.deezer.com/fr/playlist/1234567890
                                    ^^^^^^^^^^  ← this part
```

---

## Hard constraints

| Constraint | Impact |
|---|---|
| **Premium required** for full tracks | Free accounts get 30-second previews. Every GM using Lore needs a Deezer Premium subscription. |
| **iOS: always 30-second previews** | Browser-level restriction, cannot be worked around. |
| **Domain must be registered** in the Deezer developer panel | One-time config step per deployment. `localhost` is accepted for development. |
| **`appId` is public** in frontend code | Expected for OAuth client-side apps; no secret is exposed. |
| **Deezer may update streaming rights** at any time | Playlists that play today may become geo-restricted or unavailable later. |

---

## What we need to build

### 1. Register a Deezer developer app

One-time step at [developers.deezer.com](https://developers.deezer.com). Produces an `appId`. Register each domain where Lore runs (dev: `localhost:5173`, prod: actual hostname).

### 2. Serve `channel.html`

A static file at a stable URL on the Go backend. The Go server already serves `/uploads` and `/external-material` — add `channel.html` to the public root in the same way.

### 3. Expose `appId` to the frontend

Store in `lore.toml` under a new `[deezer]` section:

```toml
[deezer]
app_id = "123456"
```

Serve it through a public (no-auth) `/api/config` endpoint so the frontend can read it at runtime without baking it into the build.

### 4. `useDeezerPlayer` hook

Loads the SDK script once (idempotent), calls `DZ.init`, and exposes:

```ts
play(playlistUrl: string): void   // parses the ID internally
pause(): void
next(): void
prev(): void
setVolume(v: number): void
```

### 5. `<DeezerBar>` component in `PlayPage`

Visible only when the active scene has `playlist_type === 'deezer_playlist'` and a non-empty `playlist_value`. Shows: ▶/⏸ · ⏭ · 🔇 volume slider · playlist name (from URL). Auto-triggers `play()` on scene change (opt-in).

---

## Where in the UI

**`PlayPage`** is the right place — that is the session-running view, active when the GM is at the table. The synopsis editing view is for preparation; music belongs at play time.

The bar sits at the bottom of `PlayPage`, persistent across scene selections. Scene changes can optionally auto-trigger `DZ.player.playPlaylist()`.

---

## Sources

- [Deezer FAQs For Developers](https://support.deezer.com/hc/en-gb/articles/360011538897-Deezer-FAQs-For-Developers)
- [deezer/javascript-samples on GitHub](https://github.com/deezer/javascript-samples)
- [Deezer for developers — guidelines](https://developers.deezer.com/guidelines)
