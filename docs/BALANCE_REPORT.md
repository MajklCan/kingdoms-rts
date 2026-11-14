# Balance report

Headless AI vs AI games, equal-cost unit fights and a lockstep soak on the playable eras (Dark, Castle, Gunpowder). Total War units are scaffolded and out of scope.

## Method

- **AI vs AI batch** (`scripts/sim/ai-vs-ai.ts`, sharded by `scripts/sim/batch.mjs`, summarised by `scripts/sim/analyze.ts`): all 8 skirmish maps, starting age Dark / Castle / Gunpowder, pairings medium:medium, hard:hard, hard:medium and medium:hard (seats swapped), cap 36000 ticks (30 min game time).
  - Before: commit 5e95c4f (multiplayer fixes, no balance or AI changes), seeds 1-2, 192 games.
  - After: commit 7b08173, seed 1, 96 games. The before/after table compares the same 96 seed 1 configs.
- **Equal-cost fights** (`scripts/sim/matchups.ts`): every pair of military units, 1200 resources per side (food + wood + gold + stone), attack-moved into each other on a cleared arena, 6 fights per pair with sides swapped and the arena moved. Base stats, no techs, no AI. Cost efficiency = enemy value killed / own value lost.
- **Lockstep soak** (`scripts/sim/mp-soak.ts`): two AI clients through the real multiplayer path (session, lockstep, wire commands, in-memory relay) on a hostile network, checksums compared on every tick. See the last section.

## AI vs AI, before and after

The same 96 configs (seed 1, every map, start age and pairing, both seats) on both commits:

| | Before (5e95c4f) | After (7b08173) |
|---|---|---|
| games decided before the 30 min cap | 47 / 96 | 90 / 96 |
| timeouts medium vs medium | 24 / 24 | 5 / 24 |
| timeouts hard vs hard | 16 / 24 | 0 / 24 |
| timeouts hard vs medium (both seats) | 9 / 48 | 1 / 48 |
| hard beats medium | 81% (medium never won) | 75% (medium won 23%) |
| mirror games won by player 1 | 4 / 8 | 25 / 43 |
| all decided games won by player 1 | 22 / 47 | 46 / 90 |
| median length of decided games, Dark / Castle / Gunpowder start (min) | 24.8 / 23.2 / 24.2 | 11.3 / 12.7 / 10.5 |
| Dark start players reaching Castle Age | 36 / 64 | 22 / 64 |
| Castle start players reaching Gunpowder Age | 0 / 64 | 37 / 64 |
| games where 3+ units with a path stood still for 30 s or more | 93 | 7 |
| games with an AI stuck in one plan for 7+ min | 11 | 10 |
| villagers lost / trained | 181070 / 12845 | 11537 / 9827 |
| median peak bank food / wood / gold / stone | 5590 / 5880 / 2291 / 2285 | 1925 / 1595 / 3984 / 3965 |

The full before batch (seeds 1-2, 192 games) looks the same: 103 timeouts, every Castle start stuck below Gunpowder, stuck units in 189 games.

- **Stalemates.** Before, every medium mirror and two thirds of hard mirrors ran into the 30 min cap. Three things kept games alive: AI worksites spawned a free worker on every tick while the enemy stood on them (the loser lost 14 villagers for every one it trained, each a free target that soaked the attack), worksite workers walked in place for minutes, and no AI reached Gunpowder from Castle. After, 5 of the 6 remaining timeouts are medium mirrors, mostly in Gunpowder, where waves of at most 16 units meet a full home army, a Town Center and towers.
- **Side bias.** None visible: player 1 won 25 of 43 decided mirrors (medium 10:9, hard 15:9) and 46 of 90 decided games overall; 25 of 43 is well within chance. Per map, the largest splits are machovo_jezero 8:3 and bohemian_border_forest 3:7 out of 12 games each, also within noise for 12 games; more seeds would be needed to call a map unfair.
- **Difficulty.** Hard still wins 3 of 4 games against medium. Before, medium never beat hard, but hard also failed to finish a quarter of those games.
- **Length.** Decided games now take 10.5 to 12.7 min (median by start age), down from 23 to 25 min, when the game was decided at all. Dark starts are mostly decided before either side reaches Castle Age (22 of 64 players got there, after about 11 min).
- **Age-ups.** Castle starts reach Gunpowder in about 6 min (median) now; before, no player did within 30 min because the army spent every gold coin the age-up needed. Fewer Dark start players reach Castle Age than before only because games end earlier.
- **Composition (after).** Pikemen are the backbone (44 to 77% of units trained for the army), then archers (18 to 29%) and scouts (4 to 16%). Gunmen are 8% and cannons 3% of Gunpowder-start armies, 2% and 1% from a Castle start, and practically absent from Dark starts, which end before Gunpowder.
- **Unused content.** The AI never builds an Archery Range (archers come from barracks) or walls, in either batch. Every unit and tech was used at least once.
- **Floats.** Stone and gold pile up (median peak bank about 4000 each), mostly in Castle and Gunpowder starts, which begin with a large bank and have nothing left to spend stone on once Gunpowder is reached. Before, food and wood floated instead (median peak 5590 / 5880) while the AI sat in an age it could not leave.

## Equal-cost fights (1200 per side)

Counts per side: archer 15, pikeman 17, scout cavalry 10, gunman 10 before / 13 after, cannon 3. Wins of row over column out of 6.

Before:

| row vs col | Archer | Pikeman | Scout cav | Gunman | Cannon |
|---|---|---|---|---|---|
| Archer | - | 0 | 0 | 0 | 0 |
| Pikeman | 6 | - | 6 | 6 | 0 |
| Scout cav | 6 | 0 | - | 0 | 0 |
| Gunman | 6 | 0 | 6 | - | 0 |
| Cannon | 6 | 6 | 6 | 6 | - |

After:

| row vs col | Archer | Pikeman | Scout cav | Gunman | Cannon |
|---|---|---|---|---|---|
| Archer | - | 6 | 0 | 0 | 0 |
| Pikeman | 0 | - | 6 | 0 | 0 |
| Scout cav | 6 | 0 | - | 6 | 6 |
| Gunman | 6 | 6 | 0 | - | 0 |
| Cannon | 6 | 6 | 0 | 6 | - |

Cost efficiency after (row vs column): archer vs pikeman 2.13, pikeman vs scout 11.4, scout vs archer 2.50, gunman vs pikeman 2.78, gunman vs archer 3.61, scout vs gunman 1.72, scout vs cannon 1.50, cannon vs pikeman 2.83. Before, pikemen beat archers 2.14 : 0.47 and three cannons killed every army including scouts (5.7) without losing one. The same pattern holds at 2400 per side.

## Changes

| Change | Before | After | Why |
|---|---|---|---|
| Archer bonus vs pikeman | +2 | +7 | Archers lost to pikemen at equal cost; GDD counter is archers > pikemen. |
| Cannon splash max radius | 2.6 tiles | 1.8 tiles | One volley of three cannons killed 10 of 17 pikemen; scouts, the listed counter, lost every fight. |
| Gunman bonus vs pikeman | none | +6 | Gunpowder infantry lost to Dark Age pikemen at equal cost. |
| Scout cavalry bonus vs gunman | none | +6 | Gives gunmen a counter, so gunpowder is worth it but not strictly better. |
| Gunman cost | 45 F + 75 G | 40 F + 55 G | Still lost to pikemen with the bonus alone. |
| AI quarry target (medium, hard) | 1 quarry unless unit production is stone-starved (never, units cost no stone) | time-based quarry target while an age-up is ahead | Age-ups need 500 / 1000 stone; medium sat in Dark Age for 13 min with 5000 wood banked. |
| AI barracks (easy, medium) | 1 in Dark Age | +1 while food >= 500 and wood >= 600 | One barracks trains ~3 soldiers a minute; the rest of the economy floated. |
| AI age-up reserve (all) | army spent every gold coin | military queueing keeps the next age's gold and stone in the bank once the economy is ready to advance (not while defending) | Archers and scouts drained gold every think, so the Castle and Gunpowder age-ups waited for a lull that never came. |
| AI gold-starved Gunpowder mix (all) | army slots reserved for gunmen and cannons regardless of gold | below 55 gold those slots go to infantry | Without gold the AI idled its barracks waiting for gunmen it could not pay for. |
| AI presses an advantage (medium, hard) | fixed attack window, then cooldown even after winning the fight | while its army is >= 1.5x the enemy's (+2, min 6) the attack keeps going, idle home units reinforce it and the cooldown is skipped | Winning waves walked home and both sides rebuilt, so medium vs medium mostly ran into the 30 min cap. |
| AI free worksite crew (bug fix) | an empty AI worksite got a free worker every tick, also while enemy soldiers stood on it | not while an enemy soldier is within 8 tiles; paid re-training unchanged | The losing AI lost up to 4500 villagers after training 115; raiding an AI economy did nothing. |
| Worksite workers on a crowded node (everyone, bug fix) | duplicates re-routed every think, back to the same node when no other was free; a worker nudged past 0.55 from the node never started | share the node when no free one is reachable; a worker whose walk ended works within 0.72 | Batch flagged 3+ workers walking in place for up to 11 min; the economy lost those workers for good. |
| Farmers and units off their tile centre (everyone, bug fix) | a farm re-planned its returning workers' route every tick, throwing away detours; a unit whose straight line clipped a blocked tile stood still | the farm routes once; a blocked unit steps back to its tile centre when that has a clear run | Up to 10 villagers per side stood still with a full load at a time. |
| Sim cost (performance, no behaviour change) | late Gunpowder tick spent ~48% in worksites re-sorting every worker per site | per-site sorting, one target sort per tick, cheap range checks first | Same results bit for bit (checksums compared side by side for 16000 to 30000 ticks), about 2.2x faster stepping late game. |

## Lockstep soak (multiplayer)

`scripts/sim/mp-soak.ts` plays AI vs AI matches through the real multiplayer code: two `MultiplayerSession`s, the lockstep scheduler and the wire command codec, joined by an in-memory relay on a virtual clock. Each AI sends its orders as wire commands like a human client would. Both worlds' checksums are compared after every tick.

Conditions in the final run:

- "chaos" link: 30 ms / 120 ms latency per side, 150 ms / 250 ms jitter, 20% / 30% of frames reordered, 5% duplicated.
- One client's bitECS stores are filled with a previous match's data before the start (as in a second match in the same tab).
- At tick 6000 one client (picked by seed) saves, loads the save into a fresh world and plays on.
- Each match runs to a winner or 30000 ticks (25 min game time).

Final run on 7b08173: seeds 1-8 × all 8 maps × Dark, Castle and Gunpowder starts, 175 of the 192 matches finished (59 Dark, 59 Castle, 57 Gunpowder starts; every seed, every map with at least 18 of its 24), 4457927 ticks compared, **0 desyncs, 0 lockstep hangs**, 69 played to a winner, 106 to the 30000 tick cap. The run was stopped after about 4 hours with 17 matches left (flooded_basin, ore_mountain_pass and silesian_marsh shards). One of them, seed 2 silesian_marsh Gunpowder, had been running for over 3 hours of wall time when stopped, against about 30 min for the other silesian_marsh Gunpowder matches; it had not reported a desync or a hang, see open issues. Earlier runs on 5e95c4f to a8ef43c (about 110 matches on the chaos link) were also clean after the fixes below.

Desync root causes the soak found, all fixed with a regression test each (`src/sim/lockstep-regressions.test.ts`, `src/net/mp-hardening.test.ts`):

1. The checksum ranked entities by raw bitECS eid, so a client whose eids were recycled (a second match in the same tab) hashed differently. It ranks by NetId now.
2. Raw eid tie-breaks in formation slots, AI wave picks, the Zborov assault order and building removal. All use NetId order.
3. Removed entities left side-table entries (stuck state, paths, windups, queued impacts, AI wave lists) that a recycled eid inherited.
4. bitECS never clears component fields, and spawn helpers do not write every field, so a reused eid started with the previous owner's values (seen as villager stance anchor desyncs). Components are cleared on create.
5. A local pause or a stray local input on one client stepped a world the peer never saw. The session ignores both while in lockstep.
6. A fractional `placeBuilding` crashed the sim. The wire schema and the sim refuse non-integer tiles.
7. Save/load: restored NetIds collided with new ones, AI "never" ticks came back as null, villager stances were dropped.
8. The AI snapshot followed bitECS query order, which a loaded save cannot reproduce, so a reloaded AI queued units at a different barracks. It is in NetId order now.

Fast checks in the normal test run (`npx vitest run --dir src`): `mp-hardening.test.ts` covers latency, jitter, reordering and duplicate frames; reload from a mid-match save; a local pause and a stray local input; very different frame rates; command lag under high latency; a player leaving and a connection dropping without a goodbye (both end cleanly, no hang); the same winner on both clients; orders for units the sender does not own; packets naming unknown or dead NetIds; fractional building spots. `MP_SOAK=<seeds>` turns on whole-match soaks inside vitest. `scripts/sim/relay-smoke.ts` starts `relay/server.mjs` on a free local port and plays two clients over real WebSockets: 6000 ticks, seed 9, silesian_marsh, Gunpowder start, every tick compared, no desync. The deployed relay was not touched.

## Open issues

1. Medium mirrors in Gunpowder still reach the 30 min cap sometimes: medium waves top out at 16 units and an attack is cancelled whenever any enemy soldier comes within 11 tiles of any of the AI's buildings, so both medium AIs spend a large share of the game defending outlying camps (an AI sat in "defending" for 7+ min in 9 of 96 games). Making the defense trigger ignore outlying camps while the AI is ahead would likely fix it; not done because it changes how medium feels against a human.
2. Defender advantage: a Town Center plus towers, archers and armed villagers beats waves of about 20. A rule that sent waves at the Town Center first was tried and reverted (it fed units into the tower).
3. Dark starts are decided in about 11 min, before most players reach Castle Age, so AI vs AI rarely shows the later eras from a Dark start. Fine for a rush-capable AI, but worth knowing when tuning age-up costs.
4. Stone and gold float in Castle and Gunpowder starts (see above); the AI has no stone sink after its last age-up.
5. Archery Range and walls are never built by the AI.
6. One lockstep soak match (seed 2, silesian_marsh, Gunpowder start, chaos link, reload at 6000) ran for over 3 hours of wall time without finishing, about 6x the other silesian_marsh Gunpowder matches. The soak's hang check only fires when ticks stop advancing between steps, so this was either a very slow late game or a single step that never returned. Not investigated; rerun it alone with `npx vite-node scripts/sim/mp-soak.ts -- --seeds 2 --maps silesian_marsh --ages 2 --net chaos --reload 6000`.
7. A late Gunpowder game still costs several ms per sim tick on one core (separation is quadratic in unit count, target searches scan every entity). Fine at 20 Hz on a desktop; weaker laptops may stutter in big late fights.
