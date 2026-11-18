# Changelog

What landed on `main`, newest first. One section per merged PR or batch of direct commits, with the package version range it covers. The title menu shows the version, so a build can be matched to its section.

Live build: **kingdoms.macaly.app** runs `0.0.108` (deployed 2026-11-18).

Add a line under the matching section (or open a new one) with every change that lands on `main`.

## 0.0.110 (2026-11-18), Michal

### Fixed
- A Shift-placed building now waits behind the site its builders are working on. The first Shift+click of a row used to pull them off it at once. Idle and gathering villagers still start on it right away.

## 0.0.109 (2026-11-18), Dominik

- Docs: this changelog.

## 0.0.104 to 0.0.108 (2026-11-17 to 2026-11-18), PR #11, Dominik

### Added
- **Multi-building selection.** Box-drag, Shift+click and double-click work on your own buildings. Training from several selected producers splits the batch to the shortest queues. The queue panel merges every selected building's queue, and cancel hits the right one.
- **Endless worksites.** Mint (gold), brickworks (stone) and forester's lodge (wood) keep resources flowing after the map's deposits run dry. They open with tech ring II. The AI builds mint and brickworks once its own deposits dry up.
- **Three large 112x112 skirmish maps.** Map size is now per map instead of a global 64x64.
- **Player traces.** Every skirmish and multiplayer match records a trace of what the player did, with a usage report. Traces stay in the browser and download only with the setting on, `?trace`, or the button on the game-over screen.

### Changed
- **Archery range retired.** Barracks trains archers and spearmen, stable trains cavalry.
- **Build menu grouped by resource:** farm M, mill I, lumber camp L, gold G, stone C, barracks R, stable T, foundry F, tower Y, wall Z, house H, then forester B V, mint J, brickworks U.

### Fixed
- AI attack waves never wait for more soldiers than the population cap fits.
- AI spot search for new buildings indexes buildings once (faster late game).

## 0.0.79 to 0.0.103 (2026-11-16 to 2026-11-17), PR #10, Dominik + Michal

Also contains Michal's PR #7 (order queue), #8 (night mode) and #9 (map resources); those PRs are fully merged through this one.

### Added
- **Tech rings replace age research.** Every unit and building comes from a research. Cavalry is the second branch after Barracks, in ring I. (Michal)
- **Villagers build foundations,** build from the HUD with selected villagers.
- **Villager roles, worksite helpers and hunting.** Role workers keep their look in every direction, new gold miner, scything farmers.
- **The Commander,** one veteran per realm.
- **Order queue.** Shift + right-click queues orders with numbered waypoints; Shift+click keeps the build ghost to place several buildings in a row. (Michal)
- **Night matches by torchlight** and the Blaník Night Watch map. (Michal)
- **Fair, larger stone and gold fields** on every skirmish map. (Michal)
- Town center shoots like a tower, from further out. (Michal)
- Autosave and Continue from the main menu; Restart in the in-game menu.
- Title screen with film title card, press-to-enter gate, the four ages, pixel wordmark and crest; full-map loading screen with the destination.
- Continuous mouse-wheel zoom anchored under the cursor.
- One farm in ten grows hemp; a farm under construction looks like a field being laid out.
- Desync reports that replay a multiplayer match offline.

### Changed
- Stone is mined at half the pace of other resources. (Michal)
- Plain research names, six early houses, workers per resource in the top bar. (Michal)

### Fixed
- Lockstep peers stay in sync across browsers.
- Runtime asset URLs are versioned, so a new build never pairs with a cached atlas.
- v5 saves that reached ring III through Cavalry keep it open.
- Units no longer twitch while the game is paused; AI keeps room for builders now that workers take population.

## 0.0.63 to 0.0.78 (2026-11-14 to 2026-11-16), direct commits, Michal

### Added
- Radial tech tree with the realm's emblem at the centre; players are led to it.
- Building icons as one symbol each instead of building miniatures.
- Town center villagers find work by themselves, villager rally point.
- Worksite workers count toward population; the pop chip shows the cap from houses still rising, and houses stop past the 75 maximum.
- Four houses allowed before the Barracks tech.

### Changed
- Town center pikemen and the cheap Castle Age undone.
- Building hotkeys moved off the WASD camera keys, faster WASD pan; build hotkeys work without B, Escape cancels placement only.

### Fixed
- Units are picked by their whole figure; one-rider start.
- Touch tap on your own building selects it.
- "Waiting for P1/P2" no longer flickers in multiplayer.
- Stance and formation chips stay on the selection sheet; top bar numbers stay inside their frame.
- Unhashed assets are no longer cached for a year.

## 0.0.3 to 0.0.62 (2026-11-13 to 2026-11-14), PR #3 game overhaul, Dominik

### Added
- **Style A art.** Blender sprite pipeline and atlases for buildings, units, nature, resources and decor; seamless terrain with cliff steps; voxel bakes stay as fallback.
- **Shipped game UI.** Menus, HUD and panels rebuilt in carved wood and iron, pixel-art HUD icons, cursors, OFL fonts.
- World VFX for combat, buildings, economy and ambience; ambient life (birds, smoke, wildlife).
- Walls in skirmish and multiplayer (drag to place a line), AI breaches them.
- Berry bushes at both starts and scattered over the map.
- AI can drive any seat; headless AI-vs-AI runner and lockstep soak scripts.
- Touch controls, smooth zoom levels.
- Exact match stats and typed game events for the HUD and game-over screen.
- Relay: allowed page origins, optional hall password, join timeout, room cap.

### Changed
- Sim split into `core/`, `systems/`, `input/`, `ai/`, `missions/`, `maps/`, `save/`; `GameScene` is a thin composition root.
- Audio mix rebuilt so music, SFX and voices stop bleeding together.
- Balance and AI economy tuned from AI-vs-AI batches.
- Late-game sim cost cut about in half without changing results.

### Fixed
- Lockstep desync sources found by the AI-vs-AI net soak; bitECS component data cleared on entity creation.
- Villagers no longer get stuck with a full load or loop at worksites.

## 0.0.1 to 0.0.2 (2026-05-28 to 2026-06-10), Dominik + Michal

- Initial game: Dark to Castle Age skirmish. (Michal)
- Campaign mode and the title-screen mode menu (missions today: Siege of Brno, Battle of Bílá Hora). (Michal)
- Lockstep multiplayer: determinism gate, netcode layer, relay server, lobby, Coolify deploy. (Dominik)
- Multiplayer hardening: worksite desync fixes, diagnostics logging, cheats off in multiplayer, player-perspective HUD. (Michal)
