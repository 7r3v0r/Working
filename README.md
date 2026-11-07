# Squares of the Dead

A real-time, top-down colony-defense game for the desktop browser. Build a medieval economy across a 1,000 × 750 tile map, defend your cities from zombie waves, and win by destroying all four zombie nests. Every person is a single colored square.

Vanilla JavaScript (ES modules) and Canvas 2D. No framework, no build step, no server logic.

## Run it

**Windows:** double-click `Play.bat`. It starts a small local web server using the PowerShell built into Windows (no installs) and opens the game in your browser. Keep the black window open while you play; close it to stop.

**Anywhere else:**

```sh
npx serve .          # or: python3 -m http.server 8000
```

Open the printed URL. The page fetches `data/*.json`, so it must be served over HTTP; opening `index.html` from disk does not work.

URL options: `?seed=123` fixes the new-game seed, and `?nohelp` skips the start dialog.

## Test

```sh
npm test             # node tools/test.mjs (headless simulation, about 10 s)
```

The suite covers the economy, infection, settlers, carts, starvation, training, research, waves, nests, save/load determinism and performance. It includes the PRD acceptance criteria that can be checked without a person:

| Criterion | Test |
| --- | --- |
| An undefended region is destroyed by a wave | `waves: an undefended capital falls to a wave` |
| One zombie converts an undefended town in about 60 s | `infection: …` (about 64 s) |
| Cutting a food cart route leads to starvation and zombies | `starvation: …` |
| 4,000 units at 4x | `perf: …` (about 5 ms per tick headless; the browser held 60 fps at 4x with 4,400 units) |
| Exporting and importing a save mid-wave resumes the identical state | `saves: …` (state hashes match) |

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows, edge-scroll, middle-drag, minimap | Pan |
| Mouse wheel | Zoom (whole map to 24 px per tile) |
| Left click / drag | Select a squad or building / box-select squads |
| Right click | Move. On a nest or infected building: attack. On a tower: garrison. Shift+right-click: attack-move |
| A, H, G, P | Attack-move, hold, garrison, patrol (with squads selected) |
| Space, 1 / 2 / 3 | Pause (you can still give orders), then 1x / 2x / 4x |
| B | Show or hide the build bar (Settlement, Industry and Military tabs along the bottom) |
| C, L, R | City, Logistics and Research panels |
| Tab | Cycle cities |
| T, Y, V | Threat heatmap, region borders and vision overlays |
| Del, Esc | Demolish the selected building; cancel or deselect |

## Code layout

```
data/        map, units, buildings, research, balance (all tuning numbers live here)
src/sim/     pure simulation, no DOM: world, map rasterizer, pathing, economy (civ),
             military, zombies (AI/infection/threat/waves), logistics, vision, save
src/render/  Canvas 2D renderer + minimap
src/ui/      DOM panels, input, Web Audio alerts
tools/       headless runner + test suite
```

Key technical choices:

- **Fixed timestep:** the simulation runs at 10 ticks per second of game time and renders at display rate with interpolation.
- **Deterministic:** one seeded RNG and no wall-clock time in `sim/`. Saves store the full state plus the RNG state; all caches are pure functions of that state.
- **Hierarchical pathfinding:** 8 × 8 chunks are split into connected components, and A* runs over those components. Tile A* refines the next stretch of the route. Zombies share Dijkstra flow fields over the same graph and switch to a local tile flow field near their target city. In that local field, walls are passable at a cost, so zombies attack them.
- **Spatial hash** for neighbor queries.
- **Pre-rendered ground and fog:** each is drawn at 1 px per tile and scaled up.

## Where this differs from the PRD

These are tuning or scope decisions. All the numbers live in `data/`.

- **Map:** the layout is hand-authored in `data/map.json` (region seeds, rivers, fords, bridges, cliffs, nests, start). Fixed-seed noise fills in forest, hills, marsh and deposits, so the map is the same every run.
- **Construction:** buildings build themselves over a set time once paid for. There are no builder jobs.
- **Settlers:** a party carries 60 food in rations on top of the 100 wood + 50 stone. The goods become the new city's starting stock, and the settlers build its town hall for free. Without rations, a new city would starve before its first farm finished.
- **Town hall breach:** a town hall takes 150 zombie damage before its sheltered civilians are infected. Other buildings are infected on the first hit. Without this, one stray zombie reaching the capital ended the run in seconds.
- **Starting garrison:** you start with 3 swordsmen and 3 archers in addition to the 30 civilians.
- **Timing of raids and packs:** nest raids start on day 3 and only target cities within 260 tiles of a nest. Roaming packs start on day 2.
- **Garrison:** only towers can be garrisoned, by up to 5 archers each. Giving G on another building moves the squad next to it.
