"""Commander (COMMANDER): an older veteran in a plumed felt hat and a blue
cloak and tabard, a grey moustache and an arming sword. One per realm.

Anims: idle, move, attack (a sweeping cut, hit frame 3), death, plus two
gags the engine plays after he has stood idle for a while: `idle-smoke`
(rolls a cigarette, lights it, smokes) and `idle-sit` (sits down and looks
around). Both live in units_commander_idle.py."""

from __future__ import annotations

import math

from units_body import Leg, Pose, Puppet, death_root, idle_pose, walk_pose
from units_commander_idle import SIT_FRAMES, SMOKE_FRAMES, draw_sit, draw_smoke
from units_commander_kit import LOOK, cloak, finish_head, scabbard, sway_of, sword, tabard
from units_common import Anim, cycle
from units_rig import Mk, V

NAME = "commander"
DEF_IDS = ["COMMANDER"]

ANIMS = {
    "idle": Anim(frames=4, ms=260),
    "move": Anim(frames=8, stride=0.7),
    "attack": Anim(frames=6, ms=90, hit=3),
    "death": Anim(frames=4, ms=110, once=True, shadow="frame"),
    "idle-smoke": Anim(frames=SMOKE_FRAMES, ms=250),
    "idle-sit": Anim(frames=SIT_FRAMES, ms=500, shadow="frame"),
}

# blade angle above the horizon, torso lean, forward step per attack frame
ATTACK = [(120, 2, 0.0), (150, -4, 0.0), (160, -8, 0.0), (15, 16, 0.08), (0, 12, 0.08), (60, 4, 0.03)]
SWORD_HOLD = 64.0


def _body(mk: Mk, pup: Puppet, sheathed: bool = False, sway: float = 0.0) -> None:
    pup.legs()
    pup.body()
    tabard(mk, pup)
    cloak(mk, pup, sway=sway)
    scabbard(mk, pup, with_sword=sheathed)
    pup.arm(1)
    pup.arm(-1)
    finish_head(mk, pup)


def draw(mk: Mk, anim: str, frame: int) -> None:
    if anim == "idle-smoke":
        draw_smoke(mk, frame)
        return
    if anim == "idle-sit":
        draw_sit(mk, frame)
        return
    ang = SWORD_HOLD
    sway = 0.0
    if anim == "death":
        root, pose = death_root(cycle(frame, 4) * 4 / 3)
        _body(mk, Puppet(mk, pose, LOOK, root=root), sheathed=True)
        return
    if anim == "attack":
        ang, lean, step = ATTACK[frame % 6]
        pose = Pose(lean=lean)
        pose.legs = (Leg(thigh=24 + step * 100, knee=18, spread=0.02), Leg(thigh=-16, knee=8, spread=0.02))
        pose.hands = (V(0.13, 0.13, 0.08), V(0.12, -0.16, 0.12 + 0.22 * math.sin(math.radians(ang))))
    else:
        if anim == "move":
            pose = walk_pose(cycle(frame, 8), stride=26, arm=12)
            sway = sway_of(cycle(frame, 8))
        else:
            pose = idle_pose(cycle(frame, 4))
        pose.hands = (V(0.12, 0.15, 0.02), V(0.1, -0.2, 0.04))
    pose.poles = (V(-0.3, 1.0, -0.8), V(-0.3, -1.0, -0.6))
    pup = Puppet(mk, pose, LOOK)
    _body(mk, pup, sway=sway)
    sword(mk, pup, ang)


PORTRAIT = {"fit": "head", "density": 3.3, "anim": "idle", "frame": 0, "facing": 1}
