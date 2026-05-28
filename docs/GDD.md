# Game Design Document: Kingdoms (working title)

<!-- ASSUMPTION working title — replace with final brand when chosen -->

## Section 1 — Game Overview

- **Title:** Kingdoms (working title)
- **Tagline:** From medieval Bohemia to the First Republic — an RTS that spans a thousand years.
- **Genre:** Real-Time Strategy (RTS) — 2D isometric, historical (medieval → early 20th century)
- **Target Audience:** PC players 18-45 who loved AoE2 and Civilization-style progression; secondary: hobbyist devs / AI-agent enthusiasts watching the build process; tertiary: anyone with a Czech / Central European history interest
- **Elevator Pitch:** Begin as a medieval Bohemian prince and advance your kingdom across seven ages, ending in the industrial First Czechoslovak Republic of 1918. Web-native, deterministic, replay-shareable.
- **Unique Selling Points:**
  1. **Web-native** — zero install, runs in any modern browser
  2. **Deterministic from day 1** — replay any match, share replays via URL
  3. **AI-agent-buildable architecture** — pure functional sim, JSON state, every system testable
  4. **Sub-second iteration** — Vite HMR keeps the dev loop tight
  5. **CC0 art baseline** — instantly looks professional via Kenney Medieval RTS; voxel pipeline for custom units
- **Comparable Titles:**
  - **Age of Empires II: DE** — core inspiration. Borrow: resource model, age progression, counter system, isometric view. Differ: 2D not 3D, web-native, narrower demo scope.
  - **0 A.D.** — open-source RTS proving the model is feasible long-term. Borrow: civ-as-data, modding-friendly architecture. Differ: stay 2D sprite, narrower scope.
  - **They Are Billions** — modern web-friendly RTS aesthetic. Borrow: clean UI, readable units when zoomed out.

---

## Section 2 — Core Game Loop

### 30-second loop
```
[Select villager] --> [Right-click resource] --> [Resource ticks up] --> [Hear gather SFX] --+
       ^                                                                                     |
       +-------------------------------------------------------------------------------------+
```

### 5-minute loop (early game)
```
[Send villagers to wood/food] --> [Build house + farm + barracks] --> [Hit pop cap] --> [Train militia] --+
       ^                                                                                                  |
       +------------- [Scout enemy] <---- [Plan opening: rush / boom / drush / FC] <----------------------+
```

### Session loop (40-55 min skirmish across 7 ages)
```
[Pick civ + map + AI]
   |
   v
[Dark Age econ] -> [Feudal: scouts+archers] -> [Castle Age conflict] -> [Imperial push (gunpowder unlocked)]
                                                                              |
                                                                              v
                          [Gunpowder Age: muskets+cannon] -> [Industrial Age: factories+rail+artillery]
                                                                              |
                                                                              v
                                                  [Republic Age 1918: modern rifles+armor]
                                                                              |
                                                                              v
                                                          [Wonder / Elim / Independence] -> [Stats]
```

- **Win Conditions (any one):**
  1. **Conquest** — eliminate all enemy Town Centers (later: Town Halls)
  2. **Wonder** — build & defend a Wonder for 200 game seconds (available Imperial+)
  3. **Independence** (Republic Age only) — reach the Republic Age and research the **Independence** tech at the National University. This is the historical-endpoint victory and triggers a 1918 cinematic.
- **Lose Condition:** All your capital buildings (TC / Town Hall) destroyed; no respawn. Match ends, stats screen.

---

## Section 3 — Mechanics Deep Dive

### Primary Mechanics (the 4 core verbs)

1. **Gather** — Right-click a villager onto a resource. Unit auto-walks via A*, auto-mines, auto-deposits at nearest drop-off building. Edge: depletion swaps target to nearest same-resource within 50 tiles. Inputs: left-click select, right-click resource.
2. **Build** — Select villager(s) → press hotkey (`B` then letter) or click build button → ghost preview at cursor → click placement. Multiple villagers stack on the same foundation to speed-build. Foundation starts at 1 HP, gains HP linearly as it's built.
3. **Train** — Click production building → click unit portrait (or hotkey) → unit queued. Queue cap = 15. Resources reserved at queue time, refunded on cancel.
4. **Command** — Left-click select / left-drag box-select / shift-click add. Right-click target = context action (move, attack, gather, repair). Hotkeys: `A` attack-move, `P` patrol, `S` stop, `H` hold position. Stances: aggressive / defensive / hold ground.

### Secondary Mechanics

- **Tech Research** — Buildings unlock tech tree nodes per age. Tech consumes resources, applies instantly on completion, persists for the rest of the match.
- **Age Up** — Seven ages spanning ~1000 years: Dark → Feudal → Castle → Imperial → Gunpowder → Industrial → Republic. Each requires X buildings of the current age + Y resources. Unlocks new units, buildings, and tech on advance. The Republic Age (1918 First Czechoslovak Republic) is the historical endpoint and a key win-state milestone. <!-- See Section 4 Unlock Sequence for full per-age content -->.
- **Population** — Each unit = 1 pop. Each House = +5. Town Center = +5. Demo soft cap 75 (hard cap 200 post-demo).
- **Fog of War** — Three tile states: unexplored (black), explored (greyed), visible (lit). Vision sources: units (radius varies) and buildings.
- **Resource Economy** — Food / Wood / Gold / Stone. Every unit, building, and tech has a cost tuple.
- **Diplomacy** — Demo: ally / neutral / enemy only. <!-- ASSUMPTION tribute and diplo-stance toggling deferred to post-demo -->

### Control Scheme

| Action | Keyboard | Mouse | Touch (deferred) |
|--------|----------|-------|-------------------|
| Select unit | — | Left-click | Tap |
| Box-select | — | Left-click drag | Long-press drag |
| Add to selection | Shift+click | Shift+click | — |
| Move / context | — | Right-click | Two-finger tap |
| Attack-move | A then click | A + right-click | — |
| Patrol | P + click | — | — |
| Stop | S | — | — |
| Hold position | H | — | — |
| Build menu | B | Click portrait | — |
| Train unit | Q W E R A S D F (production grid) | Click portrait | — |
| Bind control group | Ctrl+1-9 | — | — |
| Recall control group | 1-9 | — | — |
| Camera pan | WASD / Arrows / edge-pan | — | Drag |
| Camera zoom | Mouse wheel | Mouse wheel | Pinch |
| Tech menu | T (at building) | Click building | — |
| Idle villager | . (period) | Click HUD indicator | — |

---

## Section 4 — Progression System

### Difficulty Curve

- **Within a match:** sawtooth — econ spikes (age-ups, tech), military spikes (raids, engagements). Demo target: ~25 min average match.
- **Across matches vs AI:** three difficulty tiers (Easy / Standard / Hard) modulating resource trickle, build-order quality, scout frequency, idle-villager penalty. <!-- ASSUMPTION 3 AI tiers — could ship demo with 1 (Standard) and add others post -->

### Unlock Sequence (single match) — 7-age progression to 1918

| # | Age | Era | Unlocks |
|---|-----|-----|---------|
| 1 | **Dark Age** | ~900-1100 | villagers, scout cav, house, farm, barracks, lumber camp, mining camp, mill |
| 2 | **Feudal Age** | ~1100-1300 | archery range, stable, blacksmith, market, watch tower, palisade walls, militia → man-at-arms, archer, skirmisher, scout cavalry → light cavalry |
| 3 | **Castle Age** | ~1300-1400 | castle, university, monastery, monk, knight, crossbowman, pikeman, stone walls |
| 4 | **Imperial Age** | ~1400-1500 (Hussite era) | trebuchet, hand cannon, Hussite Wagon, paladin, champion, arbalester, halberdier, hussar, wonder, gunpowder tech |
| 5 | **Gunpowder Age** | ~1500-1700 (Renaissance / Thirty Years' War) | pike-and-shot infantry, musketeer, demi-cannon, bastion fort, manufactory, bourse (market upgrade), pikemen retired |
| 6 | **Industrial Age** | ~1850-1900 (Habsburg industrialization) | factory, railway depot, line infantry, jäger, field artillery, light cavalry → uhlan, telegraph (vision tech), steam mill (econ boost), Skoda Works (UU production boost) |
| 7 | **Republic Age** | **1918 First Czechoslovak Republic — endpoint** | town hall (modern TC), modern rifle infantry, machine gun nest, armored car, ČKD light tank (LT vz. 35 prototype as UU), Tomáš Garrigue Masaryk wonder, national university, Independence tech (large pop+score bonus) |

**Note:** demo scope targets playable content through **Industrial Age** (ages 1-6). Republic Age serves as the win-state reveal — reaching it ends a match in a victory cinematic + scoring bonus. Full Republic Age content fills out post-demo.

**Pacing:** average match grows from ~25 min (AoE2-style 4 ages) to ~40-55 min with 7 ages. Earlier ages tick faster (Dark Age ~3 min if pursued aggressively); later ages have meatier tech trees and slower advance costs.

### Scoring System (post-match)

- **Military** = sum of (enemy unit cost × kills)
- **Economy** = peak resources stockpiled + villagers produced
- **Tech** = % of tech tree researched
- **Society** = buildings standing + wonders built

Used for stats screen + local leaderboard. <!-- ASSUMPTION global leaderboard out of demo scope -->

### Replayability Hooks

- **Procedural maps** — seeded; share map by seed code
- **Replay file** — deterministic, share by URL or local file
- **Civ asymmetry** — 2 civs in demo, extensible via JSON data files
- **AI personality variants** — rush / boom / turtle <!-- ASSUMPTION post-demo -->

### Estimated Play Time

- First playthrough (skirmish vs Standard AI on Arabia): 25-40 min
- "100% demo" (both civs vs all AI tiers on all maps + scenario): ~6-10 hours <!-- ASSUMPTION based on demo scope -->

---

## Section 5 — Level / World Design

### Map / Level Count

- **2 procedural skirmish maps** in demo:
  - **Arabia** — open mixed terrain, balanced resources, classic skirmish flow
  - **Black Forest** — dense pine forest forming chokepoints, slow start, defensive late-game
- **1 hand-crafted scenario:**
  - **Battle of Lechfeld 955** (Frankia scenario) — fixed start, scripted enemy waves <!-- ASSUMPTION specific scenario — swap to another famous medieval engagement if preferred -->

### Themes

| Map | Visual | Mechanical hook |
|-----|--------|-----------------|
| Arabia | Grass + sparse forests, dirt patches, scattered gold/stone | Open battlefield, raids favored, scout cav matter |
| Black Forest | Dense pine forest perimeter, central clearings | Chokepoint defense, late-game focus, castles matter |
| Lechfeld Scenario | Plains + river crossings, historical layout | Fixed objective, scripted waves, story-driven |

### Flow Map
```
[Title Menu] --> [Skirmish Setup] --> [Skirmish Game (Arabia or Black Forest)] --> [Post-game Stats]
       |                                              |
       +-> [Scenario: Lechfeld] -------> [Scenario Game] --> [Win/Loss Screen]
       |
       +-> [Replay Browser] --> [Watch Replay]
       |
       +-> [Settings]
       |
       +-> [Credits / About]
```

### Difficulty Scaling

- **Map size scales with player count:** 1v1 = 144×144 tiles; 2v2 = 200×200 (post-demo).
- **AI tier scaling:** starting-resource bonus, tech-research speed multiplier, army composition quality, idle-villager penalty.

---

## Section 6 — Characters & Entities

### Player Civilizations (demo: 2)

**Bohemia** — heavy infantry + gunpowder focus <!-- ASSUMPTION civ identity / unique unit selection — can be swapped freely -->
- **Unique Unit:** Hussite Wagon (slow ranged platform, garrison up to 4 archers, fires while moving)
- **Unique Tech:** Houfnice (bombard cannons +damage, +range)
- **Civ Bonus:** Mining +10% gold / stone yield

**Frankia** — heavy cavalry focus
- **Unique Unit:** Throwing Axeman (ranged infantry, light armor)
- **Unique Tech:** Bearded Axe (axemen +1 range)
- **Civ Bonus:** Cavaliers and Paladins +20% HP

### Unit Roster (shared baseline, demo)

| Unit | HP | Speed (t/s) | Cost | Trains at | Counters | Countered by |
|------|----|----|------|-----------|----------|--------------|
| Villager | 25 | 0.8 | 50 F | Town Center | — | Everything |
| Militia → Man-at-Arms → Long Sword → Two-Handed → Champion | 40→55→60→70→80 | 0.9 | 60 F + 20 G | Barracks | Archers (light) | Cavalry, Pikemen |
| Archer → Crossbow → Arbalester | 30→35→40 | 0.96 | 25 W + 45 G | Archery Range | Infantry | Skirmishers, Cavalry |
| Skirmisher → Elite Skirmisher | 30→35 | 0.96 | 25 F + 35 W | Archery Range | Archers | Infantry, Cavalry |
| Scout Cav → Light Cav → Hussar | 45→60→75 | 1.5 | 80 F | Stable (Dark Age scout free at TC) | Archers (run-by), Monks | Pikemen, Camels |
| Knight → Cavalier → Paladin | 100→120→160 | 1.35 | 60 F + 75 G | Stable | Archers, Workers | Pikemen, Camels |
| Spearman → Pikeman → Halberdier | 45→55→60 | 0.85 | 35 F + 25 W | Barracks | Cavalry | Archers, Infantry |
| Monk | 30 | 0.83 | 100 G | Monastery | (convert enemies, heal allies) | Eagle/Scout rush |
| Trebuchet | 150 | 0.5 | 200 W + 200 G | Castle | Buildings | Mobile units |

### AI Opponent Personalities (demo: 1 baseline)

- **Standard AI** — balanced build order, scouts at 4:00, attacks in Feudal, ages reliably, defends if pressured. <!-- ASSUMPTION more personalities (rush / boom / turtle) post-demo -->

### Building Catalog (demo)

| Building | HP | Cost | Function | Era |
|----------|----|------|----------|-----|
| Town Center | 2400 | 275 W + 100 S | Train villagers, age up, drop-off all resources | Dark |
| House | 550 | 25 W | +5 population | Dark |
| Mill | 600 | 100 W | Farm drop-off, food tech | Dark |
| Lumber Camp | 600 | 100 W | Wood drop-off, wood tech | Dark |
| Mining Camp | 600 | 100 W | Gold + stone drop-off, mining tech | Dark |
| Barracks | 1200 | 175 W | Train infantry | Dark |
| Archery Range | 1500 | 175 W | Train archers + skirmishers | Feudal |
| Stable | 1500 | 175 W | Train cavalry | Feudal |
| Watch Tower → Guard Tower | 1000 | 50 W + 125 S | Static defense, vision | Feudal |
| Blacksmith | 1500 | 175 W | Combat upgrades (atk / armor / range) | Feudal |
| Market | 1500 | 175 W | Buy/sell resources, tribute (post-demo) | Feudal |
| Palisade Wall / Stone Wall | 200 / 700 | 2 W / 5 S per tile | Block movement | Feudal / Castle |
| Monastery | 2100 | 175 W | Train monks, monk tech | Castle |
| University | 1500 | 200 W | Tech (siege, ballistics, masonry, chemistry) | Castle |
| Castle | 4800 | 650 S | Train unique unit, anti-air, vision, defense | Castle |
| Wonder | 4800 | 1000 W + 1000 F + 1000 G + 1000 S | Win condition (200s timer) | Imperial |

---

## Section 7 — UI/UX Wireframes

### HUD Layout

```
+--------------------------------------------------------------------------+
| FOOD 234   WOOD 412   GOLD 87   STONE 50    POP 23/45    AGE Feudal      |
|                                                                          |
|                                                                          |
|   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .          |
|   .                                                            .         |
|   .                                                            .         |
|   .                  GAME WORLD (iso camera)                   .         |
|   .                                                            .         |
|   .                                                            .         |
|   .                                                            .         |
|   . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .          |
|                                                                          |
+----------------------+---------------------+-----------------------------+
| [UNIT PORTRAIT]      |   MINIMAP           |  [BUILD / TRAIN GRID]       |
|  HP: ████████░░      |  (rotated iso       |   [Q] [W] [E] [R]           |
|  Atk 7  Def 2        |   minimap with      |   [A] [S] [D] [F]           |
|  Selected: 5 vills   |   unit + building   |   [Z] [X] [C] [V]           |
|  V V V V V           |   dots)             |                             |
+----------------------+---------------------+-----------------------------+
```

### Menu Flow Diagram

```
[Title]
   |
   +-> [Skirmish] -> [Setup: civ + map + AI tier] -> [Game] -> [Post-game Stats] -> [Title]
   |                                                    |
   |                                                    +-> [Pause] -> [Resume / Resign / Save Replay]
   |
   +-> [Scenarios] -> [Lechfeld] -> [Game] -> [Win/Loss] -> [Title]
   |
   +-> [Replays] -> [Browse local saved] -> [Watch w/ transport controls] -> [Title]
   |
   +-> [Settings] -> [Audio / Controls / Graphics] -> [Title]
   |
   +-> [Credits / About]
```

### Screen Mockups

- **Title** — full-bleed background art, 5 buttons stacked center-left, version + credits bottom-right
- **Skirmish Setup** — two civ cards (Bohemia / Frankia), two map cards (Arabia / Black Forest), AI difficulty radio (Easy / Standard / Hard), "Start Match" button
- **In-game** — HUD wireframe above
- **Post-game** — stats table (military / economy / tech / society), "Save Replay" button, "Rematch" / "Back to Menu"
- **Replay Player** — same in-game HUD + transport controls (play / pause / 2x / 4x / 8x) + scrub bar + tick counter
- **Settings** — tabs for Audio (3 sliders), Controls (rebind table), Graphics (resolution, fullscreen, particle quality)

### Accessibility Considerations

- Color-blind palette swap (deuteranope mode) — team colors stay distinguishable
- All hotkeys remappable
- Font size scale: 100% / 125% / 150%
- High-contrast UI mode (heavier outlines on unit selection)
- No flashing / strobing effects
- Selection feedback via outline + tone, not color alone

---

## Section 8 — Art Direction

### Visual Style

- **Stage 0 (prototype):** code-drawn iso diamonds + filled-poly units with single-letter labels. Validates game loop without art bottleneck.
- **Stage 1 (MVP target):** clean isometric medieval via [Kenney Medieval RTS (CC0)](https://kenney.nl/assets/medieval-rts) — 2D sprites, ¾ top-down perspective, painterly-but-clean style.
- **Stage 2 (active prototype):** TypeScript voxel model builders baked into Phaser textures at scene boot. See `docs/VOXEL_SPRITE_PIPELINE.md`.
- **Stage 3:** PixelLab.ai API for portraits, UI icons, and decorative one-offs.

### Color Palette

| Role | Hex | Usage |
|------|-----|-------|
| Player 1 (blue) | `#2E86DE` | Bohemia team color |
| Player 2 (red) | `#EE5253` | Frankia team color |
| Player 3 (yellow) | `#FECA57` | Gaia / 3rd player (post-demo) |
| Player 4 (green) | `#1DD1A1` | 4th player (post-demo) |
| Terrain grass | `#6AB04C` | Default ground |
| Terrain dirt | `#7E5C3B` | Roads, mined areas |
| Terrain water | `#2E86DE` / `#1E5C8C` (deep) | Lakes, rivers |
| UI background | `#1B1B2F` | HUD panels |
| UI accent | `#E8B923` | Resource icons, gold |
| Damage red | `#FF4757` | Health bars, attack feedback |

### Resolution & Scaling

- Internal game resolution: **1920×1080** (16:9)
- Scale mode: Phaser `Scale.FIT` (letterbox on non-16:9)
- Pixel-perfect: **false** (Kenney Medieval RTS is not strict pixel art)
- Camera zoom range: 0.5x – 1.5x

### Animation Guidelines

| Animation type | Frames | FPS |
|---|---|---|
| Unit idle | 4 | 4 |
| Unit walk (per of 8 directions) | 8 | 10 |
| Unit attack | 6 | 12 |
| Unit death | 6 | 10 |
| Building construction | 3 stages (foundation / half-built / complete) | — |
| Resource gather | 4-frame loop | 8 |

### Asset List with Specs

| Category | Source (Stage 1) | Format | Approx. Count |
|---|---|---|---|
| Iso terrain tiles (grass / dirt / water / forest) | Kenney Medieval RTS | PNG + Aseprite JSON atlas | ~30 |
| Buildings (TC, house, farm, mill, barracks, etc.) | Kenney Medieval RTS | PNG | ~20 |
| Units (villager + 9 unit types x 8 directions x action states) | TypeScript voxel models + runtime Phaser bake | Generated Phaser textures; see `docs/VOXEL_SPRITE_PIPELINE.md` | ~250 sprite frames |
| UI icons (resources, unit portraits, tech) | PixelLab.ai API | PNG 64×64 | ~80 |
| Cursors | Hand-drawn SVG → PNG | PNG | 4 (default / attack / garrison / no-go) |
| Title screen art | AI-gen (PixelLab / Scenario) | PNG 1920×1080 | 1 |

---

## Section 9 — Audio Design Plan

### Music Mood per Scene

| Scene | Mood | Tempo | Loop? |
|-------|------|-------|-------|
| Title | Calm, medieval, lute + choir | 70 BPM | Yes |
| Skirmish setup | Soft anticipation | 80 BPM | Yes |
| In-game peace (Dark / Feudal) | Pastoral, light percussion | 90 BPM | Yes |
| In-game tension (Castle+) | Drums layered in | 110 BPM | Yes |
| In-game combat (active battle) | Full strings + drums | 130 BPM | Yes |
| Post-game victory | Triumphant brass | 100 BPM | No |
| Post-game defeat | Somber strings | 60 BPM | No |
| Scenario intro / outro | Cinematic | varies | No |

### SFX List

| Action | Sound | Priority |
|--------|-------|----------|
| Unit select | Short voiced "Yes my lord" by class | High |
| Unit move ack | "Yes!" voiced | High |
| Villager chop wood | Wooden thunks loop | High |
| Villager mine | Pickaxe-on-stone loop | High |
| Villager farm | Wheat rustle | Medium |
| Building foundation placed | Construction clack | High |
| Building complete | Soft fanfare | High |
| Unit attack (melee) | Sword / axe impact | High |
| Unit attack (ranged) | Bowstring + arrow whiff | High |
| Unit death | Generic grunt + collapse | Medium |
| Building destroyed | Crumble + dust | Medium |
| Resource depleted | Soft "out" chime | Medium |
| Pop cap reached | Warning chime + voice "build a house" | High |
| Under attack | Tower bell + voiced warning | High |
| Tech complete | Bright ascending chime | High |
| Age advance | Long fanfare | High |
| Wonder built | Cathedral choir | High |

### Format Requirements

- All audio in both **MP3** and **OGG** for cross-browser compatibility (Phaser selects best at runtime)
- Music: 128-192 kbps stereo
- SFX: 96-128 kbps mono
- Voice: 128 kbps mono

### Volume Hierarchy

- Music: `0.4`
- SFX: `0.7`
- Voice: `0.8`
- UI sounds: `0.5`
- On major events (attack alert, age up): music ducks to `0.2` for 2 seconds, then ramps back

---

## Section 10 — Technical Requirements

- **Phaser Version:** `phaser@beta` (v4.0.0-rc.7) per `phaser4-gamedev` plugin recommendation
- **Physics Engine:** **None.** RTS uses grid-based collision + custom A* pathfinding (EasyStar.js initially, possibly navmesh later). No arcade physics — units are grid-snapped agents, not rigid bodies. Saves CPU and eliminates cross-browser physics-determinism issues.
- **State Management:**
  - Pure `step(state, inputs) → state` reducer in `/sim` (no Phaser imports)
  - bitECS for runtime entity storage (supports `createSoASerializer` for snapshots)
  - JSON data files for unit / building / tech definitions in `/data`
  - All state JSON-serializable for replay + multiplayer
- **Determinism:** Fixed timestep (20 ticks/sec sim), seeded RNG, integer arithmetic where feasible, deterministic iteration order over ECS queries. Critical for MP-ready architecture and replays.
- **Performance Budgets:**
  - 60 FPS render target on mid-range 2022 laptops
  - 20 Hz sim tick (1 simulation step every 50 ms)
  - Up to 400 simultaneous units (200 / player × 2 players in demo)
  - < 8 MB initial asset payload (lazy-load by age)
  - < 16 ms / frame render budget; < 10 ms / tick sim budget
- **Browser / Device Targets:**
  - **Tier A (full quality):** Chrome / Edge / Firefox latest, desktop, 2022+
  - **Tier B (degraded):** Safari latest, desktop
  - **Tier C (deferred):** tablets via touch input — post-demo
  - **Not supported:** mobile phones (screen real-estate insufficient for RTS HUD)

---

## Section 11 — Platform Targets & Device Profiles

### Primary Platforms

- Desktop browser (Chromium primary, Firefox secondary, Safari best-effort)
- PWA — installable, offline-capable for single-player — post-demo stretch
- Electron / Tauri desktop wrapper — post-demo, if Steam release becomes a goal

### Input per Platform

| Platform | Primary Input | Secondary Input |
|----------|---------------|-----------------|
| Desktop | Keyboard + Mouse | (gamepad not supported in demo) |
| Laptop | Keyboard + Trackpad | External mouse strongly recommended |
| Tablet | Touch (deferred) | Bluetooth keyboard + mouse |

### Deployment Method

- **Demo:** static hosting (GitHub Pages, Cloudflare Pages, or itch.io)
- **Multiplayer relay** (post-demo): Cloudflare Workers + Durable Objects, or simple Node.js websocket relay for lockstep packet shuffle. Lockstep means clients run their own sim; server only relays input packets.

---

## Section 12 — Monetization & Release Plan (Optional)

<!-- ASSUMPTION user is building this as a personal / portfolio / open-source project; revise if a commercial model is desired -->

### Business Model

- Free / open-source / portfolio project (current default)
- Donation-ware via itch.io ("name your price") later if desired
- Steam release would require Electron / Tauri wrapper + commercial asset licensing review

### Milestones (demo target — ~12 weeks part-time, accelerated with agents)

| Milestone | Week | Deliverable |
|-----------|------|-------------|
| Stage 0 prototype | 1-2 | Iso grid, coloured-shape units, click-to-move A* pathfinding, `window.__GAME__` debug, Vitest harness |
| Vertical slice | 3-5 | Bohemia civ playable, villager + militia, resource gathering, build TC + barracks + house, age-up Dark → Feudal working |
| Combat working | 6-7 | 9 unit types, counter system, attack-move, fog of war, melee/ranged distinction |
| Mid-game ages | 8-9 | Castle + Imperial ages fully content-complete (knights, gunpowder, Hussite Wagon) |
| AI opponent | 10 | Standard AI build orders, scouting, basic offense + defense |
| Asset polish (Stage 1) | 11 | Kenney Medieval RTS swapped in for all medieval entities + iso terrain tiles |
| Late-game ages | 12-13 | Gunpowder + Industrial Age content (musketeers, line infantry, field artillery, Skoda Works) |
| Republic Age end-state | 14 | 1918 victory cinematic, Independence tech, Masaryk wonder, modern unit roster preview |
| MP / replay infra | 15 | Deterministic lockstep validated, replay save / load, URL-share replays |
| Demo polish | 16 | Scenario (Lechfeld or Battle of Vyšehrad), post-game stats, audio pass, accessibility pass |

### Distribution

- GitHub repo (public; license: MIT or AGPL — decide before first push)
- itch.io page (free download / play-in-browser)
- GitHub Pages or Cloudflare Pages live build URL

---

## Post-GDD Workflow

Recommended next steps:

1. **Review assumption markers** — scan the document for `<!-- ASSUMPTION -->` comments (civ identities, AI count, scenario choice, monetization, balance numbers) and adjust to taste.
2. **Scaffold the project** — `/phaser-new` archetypes don't include "RTS"; the closest fit is `towerdefense` but a clean hand-scaffold (or `phaser-architect` agent run from this GDD) will produce a better base for the sim/render split required by the MP-ready architecture.
3. **Architect** — invoke the **phaser-architect** agent to translate this GDD into: scene graph, ECS component list, system list, data-file layout, and module structure.
4. **Implement Stage 0** — invoke the **phaser-coder** agent (or run code yourself) for the iso grid + coloured-shape villager + click-to-move prototype.

The GDD is a living document — update it as the game evolves.
