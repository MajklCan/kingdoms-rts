"""Scout cavalry: a chunky bay horse under a team caparison, a rider in a team
tunic and a pointed steel cap, an upright lance with a team pennant.

Gallop (6 frames) is a transverse gallop: hind pair, then fore pair, one
moment of suspension; the barrel rocks and the rider rides it. Attack: the
lance comes down, is drawn back and thrust (hit frame 3). Death: the horse
rolls onto its side, the rider is thrown clear."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from units_body import HEAD_R, Look, Pose, Puppet, death_root, qa
from units_common import Anim, cycle, tool_frame
from units_rig import VZ, Mk, R, S, T, V, xfp

NAME = "cavalry"
DEF_IDS = ["SCOUT_CAVALRY"]
LOOK = Look(torso="team", sleeve="team", skirt="team", skirt_len=0.06, trousers="leather", boots="boots",
            bulk=1.04, beard=True)

ANIMS = {
    "idle": Anim(frames=4, ms=280),
    "move": Anim(frames=6, stride=1.5),
    "attack": Anim(frames=6, ms=90, hit=3),
    "death": Anim(frames=4, ms=130, once=True, shadow="frame"),
}

# horse dimensions (tiles)
UPPER_F, LOWER_F = 0.16, 0.15
UPPER_H, LOWER_H = 0.16, 0.15
HOOF_H = 0.04
JOINT_F = V(0.2, 0.072, -0.06)
JOINT_H = V(-0.2, 0.072, -0.05)
BARREL_R = (0.28, 0.125, 0.13)
SADDLE_Z = 0.165  # rider pelvis above the barrel centre
LANCE_TOP = 1.6
HORSE_K = 1.25  # the horse is modelled at 1/1.25 and scaled up (riders are not)


@dataclass
class HorsePose:
    """Leg angles are (thigh, knee) in degrees, + thigh = forward, knee = bend.
    Order: left fore, right fore, left hind, right hind."""

    legs: list[tuple[float, float]] = field(default_factory=lambda: [(0, 4), (0, 4), (0, 4), (0, 4)])
    pitch: float = 0.0  # barrel pitch, + = nose down
    lift: float = 0.0  # extra barrel height
    neck: float = 0.0  # + = neck raised / head up
    head: float = 0.0  # extra head pitch, + = nose down
    tail: float = 0.0  # tail lift
    tail_yaw: float = 0.0


def _leg_pts(joint: np.ndarray, thigh: float, knee: float, upper: float, lower: float, hind: bool):
    a = math.radians(qa(thigh))
    k = math.radians(qa(knee))
    kp = joint + V(math.sin(a) * upper, 0, -math.cos(a) * upper)
    # forelegs fold the cannon bone backwards, hind legs (hock) too
    b = a - k
    hp = kp + V(math.sin(b) * lower, 0, -math.cos(b) * lower)
    return kp, hp


def _ground_z(hp: HorsePose) -> float:
    """Barrel centre height so the lowest hoof touches the ground."""
    lowest = 1.0
    pm = R("s", -qa(hp.pitch))
    for i, (th, kn) in enumerate(hp.legs):
        hind = i >= 2
        j = (JOINT_H if hind else JOINT_F) * V(1, 1 if i % 2 == 0 else -1, 1)
        up, lo = (UPPER_H, LOWER_H) if hind else (UPPER_F, LOWER_F)
        _, hoof = _leg_pts(j, th, kn, up, lo, hind)
        lowest = min(lowest, xfp(pm, hoof)[2] - HOOF_H)
    z = -lowest + hp.lift
    return round(z / VZ) * VZ


def horse(mk: Mk, hp: HorsePose, root: np.ndarray | None = None) -> np.ndarray:
    """Paints the horse; returns the barrel frame (unit-local)."""
    root = np.eye(4) if root is None else root
    hb = root @ T(0, 0, round(_ground_z(hp) * HORSE_K / VZ) * VZ) @ S(HORSE_K) @ R("s", -qa(hp.pitch))
    with mk.push(hb):
        rx, ry, rz = BARREL_R
        mk.ell(V(0, 0, 0), (rx, ry, rz), "horse")
        mk.ell(V(0.19, 0, 0.012), (0.13, 0.116, 0.132), "horse")
        mk.ell(V(-0.19, 0, 0.02), (0.14, 0.128, 0.132), "horse")
        mk.ell(V(0.0, 0, -0.07), (0.2, 0.09, 0.06), "horse_l")
        # caparison: team cloth over the back, hanging below the middle, cream hem
        cap = (rx * 0.92, ry + 0.016, rz + 0.016)
        mk.ell(V(-0.02, 0, 0), cap, "team", clip_lo=V(-0.23, -1, -0.09), clip_hi=V(0.17, 1, 1))
        mk.ell(V(-0.02, 0, 0), (cap[0] + 0.005, cap[1] + 0.004, cap[2] + 0.004), "team_trim",
               clip_lo=V(-0.23, -1, -0.105), clip_hi=V(0.17, 1, -0.08))
        # saddle
        mk.box(V(0.0, 0, 0.135), (0.13, 0.12, 0.04), "leather_d")
        mk.box(V(0.07, 0, 0.16), (0.03, 0.08, 0.04), "leather_d")
        mk.box(V(-0.07, 0, 0.155), (0.03, 0.1, 0.04), "leather_d")
        # legs
        for i, (th, kn) in enumerate(hp.legs):
            hind = i >= 2
            side = 1 if i % 2 == 0 else -1
            j = (JOINT_H if hind else JOINT_F) * V(1, side, 1)
            up, lo = (UPPER_H, LOWER_H) if hind else (UPPER_F, LOWER_F)
            kp, hoof = _leg_pts(j, th, kn, up, lo, hind)
            mk.capsule(j + V(0, 0, 0.04), kp, 0.06 if hind else 0.05, 0.034, "horse")
            mk.capsule(kp, hoof, 0.03, 0.027, "horse_d" if hind else "horse")
            mk.capsule(hoof + V(0, 0, 0.05), hoof, 0.03, 0.033, "sock" if i in (0, 3) else "horse_l")
            mk.box(hoof + V(0.01, 0, -HOOF_H * 0.5), (0.065, 0.055, HOOF_H), "hoof")
        # neck + head
        nb = V(0.25, 0, 0.06)
        with mk.push(T(*nb) @ R("s", qa(28 + hp.neck))):
            mk.capsule(V(0, 0, 0), V(0, 0, 0.26), 0.09, 0.065, "horse")
            mk.capsule(V(-0.06, 0, 0.04), V(-0.035, 0, 0.3), 0.032, 0.03, "horse_d")  # mane
            with mk.push(T(0.0, 0, 0.27) @ R("s", qa(-28 - hp.neck + 62 + hp.head))):
                mk.capsule(V(0, 0, 0), V(0.18, 0, 0), 0.07, 0.05, "horse")
                mk.ell(V(0.19, 0, -0.005), (0.04, 0.045, 0.045), "horse_l")
                mk.box(V(0.215, 0, 0.0), (0.02, 0.05, 0.02), "horse_d")
                for side in (1, -1):
                    mk.box(V(-0.03, side * 0.032, 0.075), (0.03, 0.022, 0.07), "horse_d")
                    mk.box(V(0.04, side * 0.06, 0.02), (0.03, 0.01, 0.026), "eye")
                mk.capsule(V(0.0, 0, 0.06), V(0.05, 0, 0.065), 0.02, 0.016, "horse_d")  # forelock
                # bridle
                mk.capsule(V(0.06, 0.068, -0.01), V(0.06, -0.068, -0.01), 0.012, 0.012, "leather_d", caps=False)
        # tail
        with mk.push(T(-0.31, 0, 0.06) @ R("z", qa(hp.tail_yaw)) @ R("s", qa(-35 - hp.tail))):
            mk.capsule(V(0, 0, 0), V(-0.06, 0, -0.08), 0.036, 0.042, "horse_d")
            mk.capsule(V(-0.06, 0, -0.08), V(-0.08, 0, -0.26), 0.042, 0.026, "horse_d")
    return hb


def gallop(phase: float) -> HorsePose:
    legs = []
    offs = (0.42, 0.52, 0.0, 0.1)  # LF, RF, LH, RH
    for i, off in enumerate(offs):
        t = 2 * math.pi * (phase + off)
        hind = i >= 2
        amp = 34 if hind else 40
        th = amp * math.sin(t) + (-6 if hind else 6)
        kn = (55 if hind else 85) * max(0.0, math.cos(t)) + 6
        legs.append((th, kn))
    t = 2 * math.pi * phase
    return HorsePose(legs=legs, pitch=5 * math.sin(t + 0.6), lift=0.02 * max(0.0, math.sin(t + 2.2)),
                     neck=-8 + 8 * math.sin(t + 0.4), head=6, tail=20 + 10 * math.sin(t))


def stand(phase: float) -> HorsePose:
    b = 0.5 - 0.5 * math.cos(2 * math.pi * phase)
    return HorsePose(legs=[(4, 6), (-2, 4), (-4, 6), (3, 8)], lift=VZ * (1 if b > 0.5 else 0),
                     neck=6 - 10 * b, head=-4 + 10 * b, tail=4, tail_yaw=14 * math.sin(2 * math.pi * phase))


ATTACK = [  # grip f (torso), lance pitch, rider lean, horse: neck, fore leg lift
    (0.04, 30, 2, 4, 0),
    (-0.04, 6, -8, 8, 10),
    (-0.1, 2, -12, 10, 18),
    (0.16, -4, 18, -6, 0),
    (0.12, -4, 14, -6, 0),
    (0.03, 18, 4, 0, 0),
]


def rider_legs(mk: Mk, pup: Puppet, spread: float = 0.15) -> None:
    lk = pup.look
    with mk.push(pup.pelvis_m):
        for side in (1, -1):
            hip = V(0.0, side * 0.064, 0.0)
            knee = V(0.12, side * spread, -0.09)
            ankle = V(0.06, side * (spread + 0.01), -0.25)
            mk.capsule(hip, knee, 0.054, 0.048, lk.trousers)
            mk.capsule(knee, ankle, 0.048, 0.044, lk.boots)
            mk.box(ankle + V(0.035, 0, -0.03), (0.12, 0.07, 0.055), lk.boots)
            mk.box(ankle + V(0.02, 0, -0.07), (0.07, 0.07, 0.016), "iron")  # stirrup


def cap(mk: Mk, pup: Puppet) -> None:
    r = HEAD_R
    with mk.push(pup.head_m):
        mk.ell(V(-0.008, 0, r * 0.36), (r * 1.04, r * 1.04, r * 0.86), "steel")
        mk.capsule(V(-0.01, 0, r * 0.9), V(-0.02, 0, r * 1.5), r * 0.42, 0.01, "steel")
        mk.capsule(V(-0.008, 0, r * 0.3), V(-0.008, 0, r * 0.44), r * 1.08, r * 1.06, "steel_d", caps=False)
        mk.box(V(r * 1.02, 0, r * 0.02), (0.022, 0.026, r * 0.62), "steel_d")  # nasal


def pennant(mk: Mk, top: np.ndarray, d: np.ndarray, flap: float) -> None:
    """Swallow-tail pennant just below the lance head; flies backwards (unit-local -f)."""
    d = d / np.linalg.norm(d)
    back = V(-1.0, 0.0, 0.0) - d * float(V(-1.0, 0, 0) @ d)
    if np.linalg.norm(back) < 0.2:
        back = V(0.0, -1.0, 0.0) - d * float(V(0, -1.0, 0) @ d)
    back = back / np.linalg.norm(back)
    a = top - d * 0.06
    pts = [(0.0, 0.0), (0.0, -0.12), (0.2, -0.1 + flap), (0.13, -0.06 + flap * 0.5), (0.22, -0.02 + flap)]
    mk.prism(pts, a, back, d, 0.016, "team")


def lance(mk: Mk, a: np.ndarray, b: np.ndarray, flap: float) -> None:
    mk.line(a, b, "wood_l", r=0.015)
    d = (b - a) / np.linalg.norm(b - a)
    mk.capsule(b - d * 0.01, b + d * 0.12, 0.026, 0.004, "steel")
    mk.capsule(a + d * 0.25, a + d * 0.3, 0.03, 0.03, "leather_d")
    pennant(mk, b, d, flap)


def draw(mk: Mk, anim: str, frame: int) -> None:
    look = LOOK
    if anim == "death":
        _death(mk, frame)
        return
    flap = 0.0
    rider_lean, rider_bob = 4.0, 0.0
    if anim == "idle":
        hp = stand(cycle(frame, 4))
        flap = 0.02 * math.sin(2 * math.pi * cycle(frame, 4))
    elif anim == "move":
        ph = cycle(frame, 6)
        hp = gallop(ph)
        rider_lean = 12.0
        flap = 0.04 * math.sin(2 * math.pi * ph * 2)
    else:
        f_grip, pitch, lean, neck, fore = ATTACK[frame % 6]
        hp = stand(0.0)
        hp.neck = neck
        hp.legs[0] = (fore * 2.2, fore * 4 + 4)
        rider_lean = lean
        flap = 0.02
    hb = horse(mk, hp)
    seat = T(*xfp(hb, V(0, 0, SADDLE_Z)))  # rider stays upright on a pitching horse
    pose = Pose(lean=rider_lean, seat=0.0, lift=rider_bob)
    pose.hands = (V(0.2, 0.05, 0.02), None)
    pose.poles = (V(-0.3, 1.0, -0.8), V(-0.3, -1.0, -0.6))
    if anim == "attack":
        f_grip, pitch = ATTACK[frame % 6][0], ATTACK[frame % 6][1]
        m = tool_frame(V(f_grip, -0.16, 0.13), 6.0, pitch)
        pose.hands = (V(0.2, 0.05, 0.04), xfp(m, V(0.0, 0, 0)))
    else:
        pose.hands = (V(0.2, 0.05, 0.02), V(0.1, -0.2, 0.1))
    pup = Puppet(mk, pose, look, root=seat)
    rider_legs(mk, pup)
    pup.body()
    pup.arm(1)
    pup.arm(-1)
    pup.head()
    cap(mk, pup)
    # reins: left hand to the bit
    if anim == "attack":
        m = tool_frame(V(ATTACK[frame % 6][0], -0.16, 0.13), 6.0, ATTACK[frame % 6][1])
        with mk.push(pup.torso_m):
            lance(mk, xfp(m, V(-0.34, 0, 0)), xfp(m, V(0.86, 0, 0)), flap)
        mk.mark("tip", xfp(pup.torso_m, xfp(m, V(0.98, 0, 0))))
    else:
        g = xfp(pup.torso_m, pup.p.hands[1])
        base = V(g[0] - 0.05, g[1], g[2] - 0.3)
        top = V(g[0] + 0.08, g[1], LANCE_TOP)
        lance(mk, base, top, flap)
        mk.mark("tip", top)


def _death(mk: Mk, frame: int) -> None:
    f = frame % 4
    roll = [8.0, 34.0, 66.0, 84.0][f]
    pivot = 0.13
    root = T(0, pivot, 0) @ R("f", roll) @ T(0, -pivot, 0)
    kick = [(20, 30), (40, 60), (30, 40), (24, 20)][f]
    hp = HorsePose(legs=[(kick[0], kick[1]), (kick[0] * 0.6, kick[1] * 1.2), (-kick[0], kick[1]),
                         (-kick[0] * 0.5, kick[1] * 0.7)],
                   pitch=-10 if f == 0 else 0, neck=[16, 0, -20, -30][f], head=[-10, 0, 10, 16][f], tail=-10)
    hb = horse(mk, hp, root=root)
    look = LOOK
    if f < 2:
        seat = T(*xfp(hb, V(0, 0, SADDLE_Z))) @ R("f", roll)
        pose = Pose(lean=[-14, -24][f], roll=[0, 20][f], seat=0.0,
                    arm_swing=(40, 60), arm_out=(30, 45), elbow=(30, 20))
        pup = Puppet(mk, pose, look, root=seat)
        rider_legs(mk, pup)
    else:
        rroot, pose = death_root([0.7, 1.0][f - 2])
        pup = Puppet(mk, pose, look, root=T(-0.16, -0.36, 0) @ R("z", 30) @ rroot)
        pup.legs()
    pup.body()
    pup.arm(1)
    pup.arm(-1)
    pup.head()
    cap(mk, pup)


PORTRAIT = {"fit": "whole", "anim": "idle", "frame": 0, "facing": 0}
