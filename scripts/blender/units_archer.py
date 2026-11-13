"""Archer: green hood with a point and short cape, team tunic, quiver with
white fletchings, a longbow taller than his chest. Attack: nock, raise,
draw, release (hit frame 3, the arrow leaves), follow through, lower."""

from __future__ import annotations

import math

import numpy as np

from units_body import HEAD_R, Leg, Look, Pose, Puppet, death_root, idle_pose, walk_pose
from units_common import Anim, cycle
from units_rig import Mk, R, T, V, xfp

NAME = "archer"
DEF_IDS = ["ARCHER"]
LOOK = Look(torso="team", sleeve="linen", skirt="team", skirt_len=0.09, trousers="hood_d")

ANIMS = {
    "idle": Anim(frames=4, ms=260),
    "move": Anim(frames=8, stride=0.72),
    "attack": Anim(frames=6, ms=110, hit=3),
    "death": Anim(frames=4, ms=110, once=True, shadow="frame"),
}

BOW_HALF = 0.36


def hood(mk: Mk, pup: Puppet) -> None:
    r = HEAD_R
    with mk.push(pup.head_m):
        mk.ell(V(-0.036, 0, 0.012), (r * 1.1, r * 1.12, r * 1.1), "hood")
        mk.capsule(V(-0.08, 0, r * 0.75), V(-0.15, 0, r * 0.25), r * 0.4, 0.008, "hood")
        mk.box(V(r * 0.62, 0, r * 0.62), (0.03, r * 1.3, 0.03), "hood_d")
    with mk.push(pup.torso_m):
        mk.capsule(V(-0.005, 0, 0.27), V(-0.012, 0, 0.17), 0.08, 0.15, "hood", caps=False)
        mk.capsule(V(-0.012, 0, 0.17), V(-0.014, 0, 0.155), 0.15, 0.152, "hood_d", caps=False)


def quiver(mk: Mk, pup: Puppet) -> None:
    with mk.push(pup.torso_m):
        a, b = V(-0.11, 0.06, 0.02), V(-0.14, -0.05, 0.31)
        mk.capsule(a, b, 0.036, 0.04, "leather")
        for off in (V(0, 0.016, 0.03), V(0.012, -0.014, 0.045), V(-0.014, 0.0, 0.055)):
            mk.ell(b + off, (0.016, 0.016, 0.034), "fletch")
        mk.capsule(V(0.08, 0.09, 0.22), V(-0.08, -0.08, 0.04), 0.012, 0.012, "leather_d")


def bow(mk: Mk, grip: np.ndarray, aim_yaw: float, aim_pitch: float, draw: float) -> np.ndarray:
    """Longbow in the torso frame: grip at the left hand, belly towards +f of
    the aim direction. `draw` 0..1 pulls the string back. Returns the nock point."""
    m = T(*grip) @ R("z", aim_yaw) @ R("s", -aim_pitch)
    with mk.push(m):
        n = 10
        pts = []
        bend = 0.05 + 0.05 * draw
        for i in range(n + 1):
            t = -1 + 2 * i / n
            pts.append(V(bend * (1 - t * t) - 0.02, 0.0, BOW_HALF * t * (1 - 0.08 * draw)))
        for a, b in zip(pts[:-1], pts[1:]):
            mk.capsule(a, b, 0.017, 0.017, "wood_d")
        mk.capsule(V(0.03, 0, -0.04), V(0.03, 0, 0.04), 0.022, 0.022, "leather_d")
        nock = V(-0.02 - 0.2 * draw, 0.0, 0.0)
        mk.line(pts[0] + V(-0.01, 0, 0.01), nock, "string", r=0.006)
        mk.line(nock, pts[-1] + V(-0.01, 0, -0.01), "string", r=0.006)
        if draw > 0.05:
            mk.line(nock, V(0.1, 0, 0), "wood_l", r=0.008)
            mk.box(V(0.1, 0, 0), (0.035, 0.02, 0.02), "steel")
            mk.box(nock + V(0.03, 0, 0), (0.05, 0.02, 0.03), "fletch")
    return xfp(m, V(-0.02 - 0.2 * draw, 0.0, 0.0))


ATTACK = [  # left hand (torso frame), aim pitch, draw, right hand, lean
    (V(0.16, 0.1, 0.12), 60, 0.0, V(-0.08, -0.08, 0.32), 0),  # reach to the quiver
    (V(0.2, 0.08, 0.2), 6, 0.1, V(0.12, 0.02, 0.2), 2),  # nock, raise
    (V(0.22, 0.05, 0.24), 4, 1.0, None, 2),  # full draw
    (V(0.22, 0.05, 0.24), 4, 0.0, V(-0.04, -0.17, 0.26), 2),  # release
    (V(0.21, 0.06, 0.22), 6, 0.0, V(0.0, -0.18, 0.18), 0),
    (V(0.16, 0.1, 0.12), 30, 0.0, V(0.06, -0.16, 0.08), 0),
]


def draw(mk: Mk, anim: str, frame: int) -> None:
    look = LOOK
    if anim == "death":
        root, pose = death_root(cycle(frame, 4) * 4 / 3)
        pup = Puppet(mk, pose, look, root=root)
        _body(mk, pup)
        return
    if anim in ("idle", "move"):
        pose = idle_pose(cycle(frame, 4)) if anim == "idle" else walk_pose(cycle(frame, 8), stride=30, arm=24)
        lh = V(0.06, 0.2, 0.1)
        pose.hands = (lh, None)
        pose.poles = (V(-0.4, 1.0, -0.6), None)
        pup = Puppet(mk, pose, look)
        _body(mk, pup)
        with mk.push(pup.torso_m):
            bow(mk, lh + V(0.0, 0.0, 0.0), 0.0, 0.0, 0.0)
        return
    lh, pitch, drw, rh, lean = ATTACK[frame % 6]
    pose = Pose(legs=(Leg(thigh=20, knee=10, spread=0.03), Leg(thigh=-14, knee=6, spread=0.03)),
                lean=lean, twist=-18, head_yaw=10)
    if rh is None:
        # the right hand sits on the drawn string
        m = T(*lh) @ R("z", 0) @ R("s", -pitch)
        rh = xfp(m, V(-0.02 - 0.2 * drw, -0.01, 0.0))
    pose.hands = (lh, rh)
    pose.poles = (V(-0.3, 1.0, -0.6), V(-0.6, -1.0, 0.2))
    pup = Puppet(mk, pose, look)
    _body(mk, pup)
    with mk.push(pup.torso_m):
        bow(mk, lh, 0.0, pitch, drw)
    mk.mark("bow", xfp(pup.torso_m, lh + V(0.05, 0, 0.02)))


def _body(mk: Mk, pup: Puppet) -> None:
    pup.legs()
    pup.body()
    quiver(mk, pup)
    pup.arm(1)
    pup.arm(-1)
    pup.head()
    hood(mk, pup)
    with mk.push(pup.head_m):
        pup.face()


PORTRAIT = {"fit": "head", "density": 4.0, "anim": "idle", "frame": 0, "facing": 1}

_ = math
