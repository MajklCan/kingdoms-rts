"""Field cannon: a fat bronze barrel on a team-painted split-trail carriage,
two big spoked wheels, and a gunner in a team coat with a linstock.

move: wheels roll (8 spokes, half a turn per cycle, so the loop is seamless)
while the gunner walks beside the trail. attack (8 frames): 0-2 windup
(gunner lowers the linstock to the touch hole), 3 fire (flash, the barrel
kicks), 4 recoil (the whole gun jumps back), 5-7 ram and run back up.
death: the carriage breaks, a wheel falls off, the gunner falls."""

from __future__ import annotations

import math

import numpy as np

from units_body import Look, Pose, Puppet, death_root, idle_pose, walk_pose
from units_common import Anim, cycle, straw_hat
from units_rig import Mk, R, S, T, V, xfp

NAME = "cannon"
DEF_IDS = ["CANNON"]
LOOK = Look(torso="team", sleeve="team", skirt="team", skirt_len=0.1, trousers="trousers", bulk=1.06,
            beard=False)

ANIMS = {
    "idle": Anim(frames=2, ms=420),
    "move": Anim(frames=6, stride=0.63),
    "attack": Anim(frames=8, ms=110, hit=3),
    "death": Anim(frames=3, ms=150, once=True, shadow="frame"),
}

WHEEL_R = 0.2
WHEEL_S = 0.17
AXLE_F = 0.02
BARREL_LEN = 0.66
SPOKES = 8


def wheel(mk: Mk, centre: np.ndarray, side: int, spin: float, tilt: float = 0.0) -> None:
    axis = V(0, 1, 0)
    with mk.push(T(*centre) @ R("f", tilt)):
        mk.disc(V(0, 0, 0), axis, WHEEL_R, 0.035, "wood_d", r_in=WHEEL_R - 0.035)
        mk.disc(V(0, 0, 0), axis, WHEEL_R + 0.008, 0.028, "iron", r_in=WHEEL_R - 0.004)
        for i in range(SPOKES):
            a = math.radians(spin + i * 360.0 / SPOKES)
            d = V(math.cos(a), 0, math.sin(a))
            mk.line(d * 0.04, d * (WHEEL_R - 0.03), "wood", r=0.012)
        mk.cyl(V(0, -0.035 * side, 0), V(0, 0.035 * side, 0), 0.04, "wood_d", ref=(1.0, 0.0, 0.0))
        mk.cyl(V(0, 0.03 * side, 0), V(0, 0.05 * side, 0), 0.022, "iron", ref=(1.0, 0.0, 0.0))


def carriage(mk: Mk, spin: float, broken: float = 0.0) -> None:
    """Carriage frame: origin on the ground under the axle, +f towards the muzzle."""
    for side in (1, -1):
        poly = [(-0.5, 0.0), (-0.5, 0.06), (-0.05, 0.25), (0.12, 0.3), (0.16, 0.23), (0.05, 0.16), (-0.4, 0.0)]
        mk.prism(poly, V(0, side * 0.075, 0.0), V(1, 0, 0), V(0, 0, 1), 0.04, "team")
        mk.prism([(x, y + 0.01) for x, y in poly[:3]] + [(-0.05, 0.27), (-0.5, 0.075)],
                 V(0, side * 0.075, 0.0), V(1, 0, 0), V(0, 0, 1), 0.046, "black_iron")
    mk.box(V(-0.48, 0, 0.04), (0.08, 0.2, 0.06), "wood_d")  # trail end
    mk.box(V(-0.12, 0, 0.13), (0.14, 0.15, 0.03), "wood_d")  # quoin bed
    if broken < 0.5:
        mk.cyl(V(AXLE_F, -WHEEL_S, WHEEL_R), V(AXLE_F, WHEEL_S, WHEEL_R), 0.025, "iron", ref=(1.0, 0.0, 0.0))
    wheel(mk, V(AXLE_F, WHEEL_S, WHEEL_R), 1, spin)
    if broken < 0.5:
        wheel(mk, V(AXLE_F, -WHEEL_S, WHEEL_R), -1, spin)


def barrel(mk: Mk, elev: float, kick: float, flash: bool = False, smoke: bool = False) -> np.ndarray:
    """Barrel on its trunnions; returns the frame (+x towards the muzzle)."""
    m = T(AXLE_F + 0.02 - kick, 0, WHEEL_R + 0.09) @ R("s", -elev)
    with mk.push(m):
        mk.capsule(V(-0.24, 0, 0), V(BARREL_LEN - 0.24, 0, 0), 0.078, 0.06, "bronze")
        for x, r in ((-0.2, 0.086), (-0.02, 0.08), (0.2, 0.07)):
            mk.cyl(V(x - 0.015, 0, 0), V(x + 0.015, 0, 0), r, "bronze", ref=(0.0, 0.0, 1.0))
        mk.cyl(V(BARREL_LEN - 0.27, 0, 0), V(BARREL_LEN - 0.22, 0, 0), 0.07, "bronze", ref=(0.0, 0.0, 1.0))
        mk.ell(V(-0.3, 0, 0), 0.04, "bronze")  # cascabel
        mk.cyl(V(0, -0.1, 0), V(0, 0.1, 0), 0.025, "bronze", ref=(1.0, 0.0, 0.0))  # trunnions
        mk.ell(V(BARREL_LEN - 0.22, 0, 0), (0.012, 0.04, 0.04), "powder")  # bore
        if flash:
            mk.ell(V(BARREL_LEN - 0.12, 0, 0), (0.1, 0.08, 0.08), "flash")
            mk.ell(V(BARREL_LEN - 0.02, 0, 0), (0.07, 0.06, 0.06), "spark")
            mk.ell(V(-0.2, 0, 0.09), 0.03, "spark")  # touch hole spit
    return m


ATTACK = [  # linstock tip above the touch hole, gun run back, gunner step, pushing the wheel
    (0.3, 0.0, 0.0, False),
    (0.16, 0.0, 0.0, False),
    (0.05, 0.0, 0.0, False),
    (0.05, 0.03, 0.0, False),
    (0.3, 0.1, -0.05, False),
    (0.0, 0.07, 0.1, True),
    (0.0, 0.035, 0.1, True),
    (0.3, 0.01, 0.0, False),
]

GUN_K = 1.35  # the gun is modelled at 1/1.35 and scaled up (the gunner is not)
GUNNER_AT = V(-0.36, 0.44, 0.0)


def linstock(mk: Mk, hand: np.ndarray, tip: np.ndarray, lit: bool) -> None:
    d = tip - hand
    d = d / np.linalg.norm(d)
    mk.line(hand - d * 0.14, tip, "wood_d", r=0.012)
    mk.box(tip, (0.032, 0.032, 0.032), "spark" if lit else "rope")


def draw(mk: Mk, anim: str, frame: int) -> None:
    look = LOOK
    if anim == "death":
        _death(mk, frame)
        return
    spin, kick, elev = 0.0, 0.0, 6.0
    flash = False
    gun_back = 0.0
    tip_h, push = 0.3, False
    g_at = GUNNER_AT
    if anim == "move":
        ph = cycle(frame, 6)
        spin = -180.0 * ph
        pose = walk_pose(ph, stride=26, arm=8)
    elif anim == "idle":
        pose = idle_pose(cycle(frame, 2))
    else:
        tip_h, gun_back, step, push = ATTACK[frame % 8]
        flash = frame % 8 == 3
        kick = 0.03 if flash else 0.0
        spin = gun_back / (2 * math.pi * WHEEL_R * GUN_K) * 360.0
        pose = idle_pose(0.0)
        pose.lean = 22.0 if push else (10.0 if tip_h < 0.1 else 2.0)
        g_at = GUNNER_AT + V(step, 0.0, 0.0)
    with mk.push(T(-gun_back, 0, 0) @ S(GUN_K)):
        carriage(mk, spin)
        bm = barrel(mk, elev, kick, flash)
        muzzle = mk.at(xfp(bm, V(BARREL_LEN - 0.18, 0, 0)))
        touch = mk.at(xfp(bm, V(-0.2, 0, 0.08)))
        wheel_top = mk.at(V(AXLE_F - 0.04, WHEEL_S + 0.03, WHEEL_R * 1.75))
    mk.points["muzzle"] = muzzle
    # the gunner stands on the left, turned towards the breech
    gm = T(*g_at) @ R("z", -30.0)
    pose.poles = (V(-0.3, 1.0, -0.8), V(-0.3, -1.0, -0.6))
    pup = Puppet(mk, pose, look, root=gm)
    to_torso = np.linalg.inv(pup.torso_m)
    if push:
        w = xfp(to_torso, wheel_top)
        pose.hands = (w + V(0.0, 0.08, 0.0), w + V(0.0, -0.06, -0.02))
        _gunner(mk, pup)
        return
    if anim == "move":
        pose.hands = (None, V(0.14, -0.16, 0.0))
    elif anim == "idle":
        pose.hands = (V(0.1, 0.13, 0.04), V(0.12, -0.16, 0.06))
    else:
        pose.hands = (V(0.1, 0.13, 0.04), V(0.22, -0.1, 0.14 + tip_h * 0.3))
    _gunner(mk, pup)
    h = xfp(pup.torso_m, pup.p.hands[1])
    if anim == "attack":
        tip = touch + V(0.0, 0.0, tip_h)
    else:
        tip = h + V(0.06, -0.02, 0.4)
    linstock(mk, h, tip, lit=True)


def _gunner(mk: Mk, pup: Puppet) -> None:
    pup.legs()
    pup.body()
    pup.arm(1)
    pup.arm(-1)
    pup.head()
    straw_hat(mk, pup, key="felt", trim="leather_d")


def _death(mk: Mk, frame: int) -> None:
    f = frame % 3
    tilt = [10.0, 22.0, 26.0][f]
    drop = [0.0, 0.08, 0.12][f]
    with mk.push(T(0, -0.05, -drop * 0.5) @ R("f", -tilt) @ S(GUN_K)):
        carriage(mk, 0.0, broken=1.0)
        barrel(mk, [16.0, -4.0, -8.0][f], 0.0)
    # the broken-off wheel lies flat beside the gun
    wz = [0.2, 0.1, 0.02][f]
    with mk.push(T(AXLE_F + 0.05, -0.42, wz * GUN_K) @ R("f", [-30.0, -70.0, -90.0][f]) @ S(GUN_K)):
        wheel(mk, V(0, 0, 0), -1, 20.0)
    rroot, pose = death_root([0.4, 0.75, 1.0][f])
    pup = Puppet(mk, pose, LOOK, root=T(*GUNNER_AT) @ T(-0.05, 0.05, 0) @ R("z", 60) @ rroot)
    _gunner(mk, pup)


PORTRAIT = {"fit": "whole", "anim": "idle", "frame": 0, "facing": 0}
