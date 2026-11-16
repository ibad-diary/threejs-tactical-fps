# threejs-tactical-fps

[![make.fun](https://img.shields.io/badge/make.fun-threejs--fps--01-f0a830)](https://make.fun/c/threejs-fps-01)

A round-based tactical FPS in the style Counter-Strike made famous — built with
three.js 0.187.0, running entirely from static files with no build step and no
network request. Entry for the [make.fun threejs-fps-01 bounty](https://make.fun/c/threejs-fps-01)
($1,000 prize pool).

## The game: EMBER YARD

Two teams of five fight short rounds in **Ember Yard**, an original dusk-lit
industrial yard: two lanes (Long Hall and Mid Cut) joined by a connector, a
plant site (**Site A**) at the far end, crates, containers and sightlines worth
playing. Win a round by eliminating the other team or by planting and
detonating the charge — or defusing it.

- **First-person combat** — WASD movement with acceleration, mouse look
  (pointer lock), crouch, jump, and collision with the map.
- **Gunplay that rewards stopping to aim** — hitscan weapons with headshot
  damage, recoil and spread that punish firing on the move, reloads, and
  ammunition that runs out.
- **Bots that fight back** — a finite-state machine (patrol, hold, hunt,
  plant, defuse) with A* pathfinding over the map's nav grid, sight and
  hearing perception, and reaction delays.
- **Tactics** — money earned each round, a buy menu between rounds, two
  rifles plus a sidearm, a smoke/flash grenade, and a plant/defuse objective.
- **Look and sound** — a dusk amber-and-teal palette, directional sun plus
  warm yard lamps, and fully synthesized WebAudio sound effects (no licensed
  assets).

## Play

```sh
node serve.ts
# open http://localhost:8080
```

Click to play. `W A S D` move, mouse looks, click fires, `R` reloads,
`Ctrl` crouches, `Space` jumps, `B` opens the buy menu between rounds,
`G` throws a grenade, `E` plants/defuses at Site A.

## Layout

- `game/` — the playable game (static ES modules, three.js vendored under
  `game/vendor/three/`).
- `screenshots/` — 3–4 screenshots of the game, taken from the running game.
- `main.ts` — the entry program: copies `game/` and `screenshots/` to
  `/output` and writes `/output/dossier.json`.
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged.

## License

MIT — see [LICENSE](LICENSE).
