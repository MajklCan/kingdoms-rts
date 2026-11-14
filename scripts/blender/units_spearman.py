"""Pikeman (SPEARMAN): steel kettle hat, team tabard with a white cross, big
team heater shield on the left arm and a pike well above his head. Attack:
pike levelled, drawn back and thrust (hit frame 3).

Militia (legacy, untrainable) reuses this body with a short sword instead of
the pike (`draw_militia`)."""

from __future__ import annotations

import math

import numpy as np

from units_body import Leg, Look, Pose, Puppet, death_root, idle_pose, walk_pose
from units_common import Anim, cycle, kettle_hat, tool_frame
from units_rig import Mk, V, xfp

NAME = "spearman"
DEF_IDS = ["SPEARMAN"]
LOOK = Look(torso="linen", sleeve="linen", skirt="linen_d", skirt_len=0.08, bulk=1.04)

ANIMS = {
    "idle": Anim(frames=4, ms=260),
    "move": Anim(frames=8, stride=0.7),
    "attack": Anim(frames=6, ms=90, hit=3),
    "death": Anim(frames=4, ms=110, once=True, shadow="frame"),
}

PIKE_TOP = 1.18  # tiles above the ground when upright
PIKE_BACK = 0.5  # pike length behind the grip when levelled
PIKE_FWD = 0.78


def tabard(mk: Mk, pup: Puppet) -> None:
    with mk.push(pup.torso_m):
        mk.ell(V(0.006, 0, 0.13), (0.1, 0.104, 0.155), "team")
        mk.capsule(V(0.0, 0, 0.07), V(0.0, 0, -0.07), 0.104, 0.12, "team", caps=False)
        mk.capsule(V(0, 0, 0.05), V(0, 0, 0.022), 0.108, 0.11, "leather_d", caps=False)
        mk.box(V(0.098, 0, 0.12), (0.03, 0.03, 0.16), "team_trim")
        mk.box(V(0.098, 0, 0.15), (0.03, 0.12, 0.03), "team_trim")


def shield(mk: Mk, pup: Puppet, centre_t, yaw: float = 38.0) -> None:
    """Heater shield in the torso frame, face turned `yaw` deg from the left towards the front."""
    sw = 0.13
    pts = [(-sw, 0.14), (sw, 0.14), (sw, 0.02), (sw * 0.62, -0.1), (0.0, -0.18), (-sw * 0.62, -0.1), (-sw, 0.02)]
    a = math.radians(yaw)
    u = V(math.cos(a), -math.sin(a), 0.0)  # along the face (mostly forward)
    n = V(math.sin(a), math.cos(a), 0.0)  # face normal (outwards)
    up = V(0, 0, 1)
    c = V(*centre_t)
    with mk.push(pup.torso_m):
        mk.prism([(x * 1.1, y * 1.08 + 0.004) for x, y in pts], c - n * 0.004, u, up, 0.022, "wood_d")
        mk.prism(pts, c + n * 0.01, u, up, 0.018, "team")
        mk.prism([(x * 0.24, y * 0.9) for x, y in pts], c + n * 0.02, u, up, 0.01, "team_trim")
        mk.ell(c + n * 0.024 + up * 0.03, 0.026, "steel")


def pike(mk: Mk, a, b) -> None:
    a, b = V(*a), V(*b)
    mk.line(a, b, "wood", r=0.016)
    d = (b - a) / np.linalg.norm(b - a)
    mk.capsule(b - d * 0.02, b + d * 0.05, 0.028, 0.036, "steel")
    mk.capsule(b + d * 0.05, b + d * 0.17, 0.036, 0.004, "steel")


ATTACK = [  # grip f (along the pike, torso frame), pitch of the pike, lean, step
    (0.02, 40, 2, 0.0),
    (-0.04, 4, -4, 0.0),
    (-0.1, 2, -8, 0.0),
    (0.16, -4, 16, 0.08),
    (0.12, -4, 12, 0.08),
    (0.02, 22, 4, 0.03),
]


def draw(mk: Mk, anim: str, frame: int, weapon: str = "pike") -> None:
    look = LOOK
    if anim == "death":
        root, pose = death_root(cycle(frame, 4) * 4 / 3)
        pup = Puppet(mk, pose, look, root=root)
        _body(mk, pup, pose)
        return
    if anim == "idle":
        pose = idle_pose(cycle(frame, 4))
    elif anim == "move":
        pose = walk_pose(cycle(frame, 8), stride=28, arm=12)
    else:
        f_grip, pitch, lean, step = ATTACK[frame % 6]
        pose = Pose(lean=lean)
        pose.legs = (Leg(thigh=24 + step * 100, knee=18, spread=0.02), Leg(thigh=-16, knee=8, spread=0.02))
    upright = anim != "attack"
    sway = 0.0
    if anim == "move":
        sway = 3.0 * math.sin(2 * math.pi * cycle(frame, 8) * 2)
    if weapon == "pike":
        if upright:
            grip = V(0.07, -0.21, 0.07)
            pose.hands = (V(0.12, 0.12, 0.05), grip)
            pose.poles = (V(-0.3, 1.0, -0.8), V(-0.3, -1.0, -0.6))
        else:
            m = tool_frame(V(f_grip, -0.12, 0.12), 0.0, pitch)
            back = xfp(m, V(0.0, 0, 0))
            front = xfp(m, V(0.2, 0, 0))
            pose.hands = (front + V(0, 0.04, -0.01), back)
            pose.poles = (V(-0.2, 1.0, -1.0), V(-0.3, -1.0, -0.6))
    else:  # militia: arming sword
        if anim == "attack":
            sword_keys = [(110, 0.3), (140, 0.34), (150, 0.36), (20, 0.18), (0, 0.14), (70, 0.24)]
            ang, zz = sword_keys[frame % 6]
            pose.hands = (V(0.13, 0.13, 0.08), V(0.12, -0.16, zz))
        else:
            pose.hands = (V(0.12, 0.12, 0.05), V(0.1, -0.2, 0.04))
        pose.poles = (V(-0.3, 1.0, -0.8), V(-0.3, -1.0, -0.6))
    pup = Puppet(mk, pose, look)
    _body(mk, pup, pose)
    # weapon + shield
    if weapon == "pike":
        if upright:
            g = xfp(pup.torso_m, pup.p.hands[1])
            lean = math.radians(sway)
            base = V(g[0] - math.sin(lean) * g[2], g[1], 0.02)
            top = V(g[0] + math.sin(lean) * (PIKE_TOP - g[2]), g[1], PIKE_TOP)
            pike(mk, base, top)
            mk.mark("tip", top + V(0, 0, 0.17))
        else:
            m = tool_frame(V(f_grip, -0.12, 0.12), 0.0, pitch)
            with mk.push(pup.torso_m):
                pike(mk, xfp(m, V(-PIKE_BACK, 0, 0)), xfp(m, V(PIKE_FWD, 0, 0)))
            mk.mark("tip", xfp(pup.torso_m, xfp(m, V(PIKE_FWD + 0.17, 0, 0))))
    else:
        ang = 70.0
        if anim == "attack":
            ang = [(110, 0.3), (140, 0.34), (150, 0.36), (20, 0.18), (0, 0.14), (70, 0.24)][frame % 6][0]
        g = pup.p.hands[1]
        with mk.push(pup.torso_m @ tool_frame(g, 0, ang)):
            mk.box(V(-0.02, 0, 0), (0.05, 0.03, 0.03), "leather_d")
            mk.box(V(0.03, 0, 0), (0.02, 0.1, 0.025), "iron")
            mk.box(V(0.2, 0, 0), (0.3, 0.032, 0.012), "steel")
    lh = pup.p.hands[0]
    shield(mk, pup, lh + V(-0.01, 0.07, 0.04), yaw=30.0 if anim != "attack" else 55.0)


def _body(mk: Mk, pup: Puppet, pose: Pose) -> None:
    pup.legs()
    pup.body()
    tabard(mk, pup)
    pup.arm(1)
    pup.arm(-1)
    pup.head()
    kettle_hat(mk, pup)


def draw_militia(mk: Mk, anim: str, frame: int) -> None:
    draw(mk, anim, frame, weapon="sword")


PORTRAIT = {"fit": "head", "density": 4.0, "anim": "idle", "frame": 0, "facing": 1}
