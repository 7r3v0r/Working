# Squares of the Dead

A real-time, top-down colony-defense game for the desktop browser. Build a medieval economy across a 1,000 × 750 tile map, defend your cities from zombie waves, and win by destroying all four zombie nests. Zoomed out, every person is a single colored square; zoomed in, people and buildings are 16 px pixel art.

Vanilla JavaScript (ES modules) and Canvas 2D. No framework, no build step, no server logic, no image files.

## Run it

**Windows:** double-click `Play.bat`. It starts a small local web server using the PowerShell built into Windows (no installs) and opens the game in your browser. Keep the black window open while you play; close it to stop.

**Anywhere else:**

```sh
npx serve .          # or: python3 -m http.server 8000
```

Open the printed URL. The page fetches `data/*.json`, so it must be served over HTTP; opening `index.html` from disk does not work.

**Saving:** Save stores the game in your browser and also downloads a `.json` copy. The game also autosaves to the browser every 2 in-game minutes and when you leave the page. Load lists the browser saves (Continue on the start screen picks the newest) and can still load a downloaded file if browser data was cleared. Browser saves are per browser and computer; up to 10 manual saves are kept.

URL options: `?seed=123` fixes the new-game seed, and `?nohelp` skips the start dialog.

**Visual styles:** the Style button in the top bar cycles Classic, Parchment, Night Watch and Meadow (`?style=parchment`, `nightwatch` or `meadow` picks one directly; the choice is remembered). A style is only a set of colors in `src/render/themes.js` plus a block of CSS variables in `style.css`. It is applied once, so every style draws at the same speed.

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
| Mouse wheel | Zoom (whole map to 32 px per tile; pixel art from 8 px per tile for buildings and 10 for units) |
| Left click / drag | Select a soldier or building / box-select soldiers (Shift adds) |
| Double-click | Select a soldier's whole squad |
| Right click | Move. On a nest or infected building: attack. On a tower: garrison. Shift+right-click: add a move waypoint (queued after the current move) |
| A, H, G, P | Attack-move (Shift-click adds attack-move waypoints), hold, garrison, patrol (with squads selected) |
| Space, 1 / 2 / 3 | Pause (you can still give orders), then 1x / 2x / 4x |
| B | Show or hide the build bar (Settlement, Industry and Military tabs along the bottom) |
| C, L, R | City, Logistics and Research panels |
| Tab | Cycle cities |
| Hover a resource | Net rate per game minute over the last 2 minutes, with sources and uses |
| T, Y, V | Threat heatmap, region borders and vision overlays |
| Del, Esc | Demolish the selected building; cancel or deselect |
| Repair button | On a damaged building's panel, or "Repair all" in the City panel |

## Code layout

```
data/        map, units, buildings, research, balance (all tuning numbers live here)
src/sim/     pure simulation, no DOM: world, map rasterizer, pathing, economy (civ),
             military, zombies (AI/infection/threat/waves), logistics, vision, save
src/render/  Canvas 2D renderer + minimap, visual styles (themes.js), pixel-art sprites (sprites.js)
src/ui/      DOM panels, input, Web Audio alerts
tools/       headless runner + test suite
```

Key technical choices:

- **Fixed timestep:** the simulation runs at 10 ticks per second of game time and renders at display rate with interpolation.
- **Deterministic:** one seeded RNG and no wall-clock time in `sim/`. Saves store the full state plus the RNG state; all caches are pure functions of that state.
- **Hierarchical pathfinding:** 8 × 8 chunks are split into connected components, and A* runs over those components. Tile A* refines the next stretch of the route. Zombies share Dijkstra flow fields over the same graph and switch to a local tile flow field near their target city. In that local field, walls are passable at a cost, so zombies attack them.
- **Spatial hash** for neighbor queries.
- **Pre-rendered ground and fog:** each is drawn at 1 px per tile and scaled up.
- **Sprites drawn in code:** `src/render/sprites.js` paints every unit and building (16 px per tile) into one atlas canvas when a game or style loads. Each unit is then one unscaled `drawImage` from a copy of the atlas cached at the current zoom. Below 10 px per tile units fall back to squares batched into one path per color, and below 8 px per tile buildings fall back to flat blocks.

## Where this differs from the PRD

These are tuning or scope decisions. All the numbers live in `data/`.

- **Map:** the layout is hand-authored in `data/map.json` (region seeds, rivers, fords, bridges, cliffs, nests, start). Fixed-seed noise fills in forest, hills, marsh and deposits, so the map is the same every run.
- **Construction:** buildings build themselves over a set time once paid for. There are no builder jobs.
- **Settlers:** a party carries 180 food in rations on top of the 300 wood + 150 stone. The goods become the new city's starting stock, and the settlers build its town hall for free. Without rations, a new city would starve before its first farm finished.
- **Camps:** a smaller expansion (10 civilians, 100 wood + 50 stone + 60 food) inside a city's own region. The party builds a camp, and the city can then place buildings within 30 tiles of it. The camp accepts every good, the rations go into the city's stock, and the civilians stay with the city.
- **Town hall breach:** a town hall takes 150 zombie damage before its sheltered civilians are infected. Other buildings are infected on the first hit. Without this, one stray zombie reaching the capital ended the run in seconds.
- **Starting garrison:** you start with 3 swordsmen and 3 archers in addition to the 30 civilians.
- **Timing of raids and packs:** nest raids start on day 3 and only target cities within 260 tiles of a nest. Roaming packs start on day 2.
- **Fog and pathing:** soldiers and civilians plan routes on what you have explored. Unexplored ground counts as open, so a unit heads straight into the unknown and reroutes when it reaches a river or cliff it hadn't seen.
- **Gates:** a gate can be drawn straight over a wall; the wall is removed when the gate is placed. The tile is open until the gate finishes building (4–6 s).
- **Repairs:** cost half the building's price scaled by missing HP, paid up front. HP returns over the build time scaled by missing HP (at least 3 s) and pauses while the building is under attack.
- **Zombies nearby:** nothing can be built, and no road laid, within 10 tiles of a zombie you can see.
- **Garrison:** only towers can be garrisoned, by up to 5 archers each. Giving G on another building moves the squad next to it.
