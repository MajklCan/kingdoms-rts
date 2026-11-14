# Balance report

Headless AI vs AI and equal-cost unit fights on the playable eras (Dark, Castle, Gunpowder). Total War units are scaffolded and out of scope.

## Method

- **AI vs AI batch** (`scripts/sim/ai-vs-ai.ts`, sharded by `scripts/sim/batch.mjs`, summarised by `scripts/sim/analyze.ts`): seeds 1-2, all 8 skirmish maps, starting age Dark / Castle / Gunpowder, pairings medium:medium, hard:hard, hard:medium and medium:hard (seats swapped), 192 games, cap 36000 ticks (30 min game time). The same configs ran before and after the changes.
- **Equal-cost fights** (`scripts/sim/matchups.ts`): every pair of military units, 1200 resources per side (food + wood + gold + stone), attack-moved into each other on a cleared arena, 6 fights per pair with sides swapped and the arena moved. Base stats, no techs, no AI. Cost efficiency = enemy value killed / own value lost.

AI_BATCH_PLACEHOLDER

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

## Open issues

OPEN_PLACEHOLDER
