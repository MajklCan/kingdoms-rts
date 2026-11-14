"""Humanoid puppet shared by every foot unit (and the riders and gun crews).

Proportions are the "big unit" RTS kind: about 0.9 tile (36 px at 1x) from
boots to hat, a head about a quarter of that, thick limbs and big hands, so
the silhouette and the face survive at game scale.

The puppet is posed with plain numbers (degrees, tile units). Legs use
forward kinematics from the hip; arms either swing (FK) or reach for a hand
target (two-bone IK), which is how weapons are held. The pelvis is lowered
or raised so the lower foot stands on the ground, quantised to whole voxel
layers so the body does not shimmer between frames.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from units_rig import VZ, Mk, R, T, V, xfp

# --- dimensions (tile units) --------------------------------------------------
THIGH = 0.15
SHIN = 0.145
ANKLE_Z = 0.05
HIP_HALF = 0.064
THIGH_R = 0.052
SHIN_R = 0.046
TORSO_R = (0.092, 0.128, 0.15)
TORSO_Z = 0.13  # torso centre above the hip joint
SHOULDER_Z = 0.225
SHOULDER_HALF = 0.142
UPPER = 0.12
FORE = 0.12
ARM_R = 0.04
HAND_R = 0.044
HEAD_Z = 0.395  # head centre above the hip joint
HEAD_R = 0.116


def qa(deg: float, step: float = 3.0) -> float:
    """Quantise a joint angle so shapes stay stable between frames."""
    return round(deg / step) * step


@dataclass
class Leg:
    thigh: float = 0.0  # deg, + = forward
    knee: float = 6.0  # deg of bend
    spread: float = 0.0  # extra sideways offset of the foot (tiles)
    foot: float = 0.0  # extra foot pitch (deg, + = toe down)


@dataclass
class Pose:
    """Everything a humanoid needs for one frame."""

    legs: tuple[Leg, Leg] = field(default_factory=lambda: (Leg(), Leg()))  # left, right
    lean: float = 0.0  # torso pitch forward (deg)
    roll: float = 0.0  # torso roll (deg, + = towards the left side)
    twist: float = 0.0  # torso yaw (deg, + = turns left)
    head_pitch: float = 0.0
    head_yaw: float = 0.0
    lift: float = 0.0  # extra pelvis height (tiles), e.g. a hop
    crouch: float = 0.0  # pelvis drop (tiles) on top of the leg solve
    seat: float | None = None  # riders: fixed pelvis height instead of the leg solve
    # arms: either an FK swing (deg) or an IK hand target in the TORSO frame
    arm_swing: tuple[float, float] = (0.0, 0.0)
    arm_out: tuple[float, float] = (10.0, 10.0)
    elbow: tuple[float, float] = (20.0, 20.0)
    hands: tuple[np.ndarray | None, np.ndarray | None] = (None, None)
    poles: tuple[np.ndarray | None, np.ndarray | None] = (None, None)


def leg_points(leg: Leg, side: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    a = math.radians(qa(leg.thigh))
    k = math.radians(qa(leg.knee))
    hip = V(0.0, side * HIP_HALF, 0.0)
    knee = hip + V(math.sin(a) * THIGH, side * leg.spread * 0.5, -math.cos(a) * THIGH)
    ankle = knee + V(math.sin(a - k) * SHIN, side * leg.spread * 0.5, -math.cos(a - k) * SHIN)
    return hip, knee, ankle


def pelvis_height(p: Pose) -> float:
    if p.seat is not None:
        return round(p.seat / VZ) * VZ
    lowest = min(leg_points(p.legs[0], 1)[2][2], leg_points(p.legs[1], -1)[2][2])
    z = ANKLE_Z - lowest + p.lift - p.crouch
    return round(z / VZ) * VZ


def walk_pose(phase: float, stride: float = 30.0, arm: float = 26.0, lean: float = 5.0) -> Pose:
    """Classic walk: phase 0 = left leg passing under the body."""
    s = math.sin(2 * math.pi * phase)
    c = math.cos(2 * math.pi * phase)
    lt = stride * s
    rt = -stride * s
    lk = 8 + 46 * max(0.0, c)
    rk = 8 + 46 * max(0.0, -c)
    left = Leg(thigh=lt, knee=lk, foot=-10 * max(0.0, c) + 12 * max(0.0, -s))
    right = Leg(thigh=rt, knee=rk, foot=-10 * max(0.0, -c) + 12 * max(0.0, s))
    return Pose(legs=(left, right), lean=lean, twist=4 * s, arm_swing=(-arm * s, arm * s),
                elbow=(18 + 10 * max(0.0, -s), 18 + 10 * max(0.0, s)))


def idle_pose(phase: float) -> Pose:
    """Weight on both feet, a slow breath (shoulders rise one layer)."""
    b = 0.5 - 0.5 * math.cos(2 * math.pi * phase)
    return Pose(legs=(Leg(thigh=3, knee=6, spread=0.012), Leg(thigh=-3, knee=6, spread=0.012)),
                lean=1.0 - 2.0 * b, crouch=0.0 if b < 0.5 else VZ, arm_swing=(2 * b, 2 * b))


@dataclass
class Look:
    """Materials and shapes of one humanoid."""

    skin: str = "skin"
    hair: str | None = "hair"
    trousers: str = "trousers"
    boots: str = "boots"
    sleeve: str = "linen"
    torso: str = "team"
    belt: str | None = "leather_d"
    skirt: str | None = None
    skirt_len: float = 0.09
    beard: bool = False
    bulk: float = 1.0


class Puppet:
    """Paints one posed humanoid. Afterwards `torso_m` (unit-local torso frame)
    and the named hand points let the unit add weapons and gear."""

    def __init__(self, mk: Mk, pose: Pose, look: Look, root: np.ndarray | None = None):
        self.mk = mk
        self.p = pose
        self.look = look
        self.root = root if root is not None else np.eye(4)
        z = pelvis_height(pose)
        self.pelvis_m = self.root @ T(0, 0, z)
        self.torso_m = self.pelvis_m @ R("z", qa(pose.twist)) @ R("s", qa(pose.lean)) @ R("f", qa(pose.roll))
        self.head_m = self.torso_m @ T(0, 0, HEAD_Z) @ R("z", qa(pose.head_yaw)) @ R("s", qa(pose.head_pitch))
        self.hand_pts: dict[int, np.ndarray] = {}
        self.elbow_pts: dict[int, np.ndarray] = {}

    # -- parts --------------------------------------------------------------------
    def legs(self) -> None:
        mk, lk = self.mk, self.look
        b = lk.bulk
        with mk.push(self.pelvis_m):
            for leg, side in ((self.p.legs[0], 1), (self.p.legs[1], -1)):
                hip, knee, ankle = leg_points(leg, side)
                mk.capsule(hip, knee, THIGH_R * b, SHIN_R * b * 1.02, lk.trousers)
                mk.capsule(knee, ankle, SHIN_R * b, SHIN_R * b * 0.95, lk.boots if leg.knee < 999 else lk.trousers)
                pitch = qa(leg.foot + (qa(leg.thigh) - qa(leg.knee)) * 0.25)
                with mk.push(T(*ankle) @ R("s", pitch)):
                    mk.box(V(0.03, 0.0, -0.022), (0.135, 0.085 * b, 0.06), lk.boots)
                    mk.box(V(0.08, 0.0, -0.038), (0.05, 0.08 * b, 0.026), "leather_d")

    def body(self) -> None:
        mk, lk = self.mk, self.look
        b = lk.bulk
        with mk.push(self.torso_m):
            r = TORSO_R
            mk.ell(V(0, 0, TORSO_Z), (r[0] * b, r[1] * b, r[2]), lk.torso)
            if lk.skirt:
                mk.capsule(V(0, 0, 0.06), V(0, 0, -lk.skirt_len), 0.098 * b, 0.118 * b, lk.skirt, caps=False)
            if lk.belt:
                mk.capsule(V(0, 0, 0.055), V(0, 0, 0.02), 0.102 * b, 0.104 * b, lk.belt, caps=False)

    def head(self, eyes: bool = True) -> None:
        mk, lk = self.mk, self.look
        r = HEAD_R
        with mk.push(self.torso_m):
            mk.capsule(V(0, 0, SHOULDER_Z - 0.02), V(0, 0, HEAD_Z - r * 0.5), 0.045, 0.045, lk.skin)
        with mk.push(self.head_m):
            mk.mark("head", V(0, 0, r * 1.5))  # top of the hat, for bars and portraits
            mk.ell(V(0, 0, 0), (r, r * 0.98, r * 0.95), lk.skin)
            if lk.hair:
                mk.ell(V(-0.03, 0, 0.022), (r * 0.92, r * 1.02, r * 0.95), lk.hair)
            if lk.beard:
                mk.ell(V(r * 0.55, 0, -r * 0.55), (r * 0.5, r * 0.7, r * 0.45), "beard")
            if eyes:
                self.face()

    def face(self) -> None:
        r = HEAD_R
        mk = self.mk
        for side in (1, -1):
            mk.box(V(r * 0.86, side * r * 0.4, -r * 0.02), (0.06, 0.026, 0.052), "eye")
        mk.box(V(r * 1.0, 0.0, -r * 0.3), (0.03, 0.03, 0.03), "skin_d")

    def arm(self, side: int, sleeve: str | None = None, hand: str | None = None, show_hand: bool = True) -> np.ndarray:
        """side 1 = left, -1 = right. Returns the hand centre (unit-local)."""
        mk, lk, p = self.mk, self.look, self.p
        idx = 0 if side == 1 else 1
        sleeve = sleeve or lk.sleeve
        b = lk.bulk
        sh = V(0, side * SHOULDER_HALF * b, SHOULDER_Z)
        target = p.hands[idx]
        with mk.push(self.torso_m):
            if target is None:
                sw = math.radians(qa(p.arm_swing[idx]))
                ab = math.radians(qa(p.arm_out[idx]))
                d = np.array([math.sin(sw) * math.cos(ab), side * math.sin(ab), -math.cos(sw) * math.cos(ab)])
                elbow = sh + d * UPPER
                e = math.radians(qa(p.elbow[idx]))
                fd = np.array([math.sin(sw + e) * math.cos(ab), side * math.sin(ab) * 0.6,
                               -math.cos(sw + e) * math.cos(ab)])
                handp = elbow + fd / np.linalg.norm(fd) * FORE
            else:
                handp = np.asarray(target, dtype=np.float64)
                pole = p.poles[idx]
                if pole is None:
                    pole = V(-0.6, side * 1.0, -0.5)
                elbow = two_bone(sh, handp, UPPER, FORE, pole)
            mk.capsule(sh, elbow, ARM_R * b * 1.1, ARM_R * b, sleeve)
            mk.capsule(elbow, handp, ARM_R * b, ARM_R * b * 0.9, sleeve)
            if show_hand:
                mk.ell(handp, HAND_R, hand or lk.skin)
            hw = xfp(self.torso_m, handp)
            self.elbow_pts[side] = xfp(self.torso_m, elbow)
        self.hand_pts[side] = hw
        return hw


def two_bone(a: np.ndarray, t: np.ndarray, l1: float, l2: float, pole: np.ndarray) -> np.ndarray:
    d = t - a
    dist = float(np.linalg.norm(d))
    dist = min(max(dist, 1e-4), (l1 + l2) * 0.999)
    u = d / max(float(np.linalg.norm(d)), 1e-9)
    x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(l1 * l1 - x * x, 0.0))
    pv = np.asarray(pole, dtype=np.float64)
    pv = pv - u * float(pv @ u)
    n = float(np.linalg.norm(pv))
    pv = pv / n if n > 1e-9 else np.array([0.0, 0.0, -1.0])
    return a + u * x + pv * h


def torso_point(pup: Puppet, p) -> np.ndarray:
    """Torso-frame point -> unit-local."""
    return xfp(pup.torso_m, p)


def death_root(phase: float, back: bool = True) -> tuple[np.ndarray, Pose]:
    """Root transform + pose of a soldier falling over (phase 0..1).

    Falls backwards around the heels; the last frame lies flat."""
    ease = phase * phase * (3 - 2 * phase)
    tilt = -82.0 * ease if back else 82.0 * ease
    pivot = -0.08 if back else 0.08
    root = T(pivot, 0, 0) @ R("s", qa(tilt, 6.0)) @ T(-pivot, 0, ease * 0.05)
    k = 20 + 40 * math.sin(math.pi * min(1.0, phase * 1.3))
    pose = Pose(legs=(Leg(thigh=10 + 25 * ease, knee=k), Leg(thigh=-5 + 15 * ease, knee=k * 0.6)),
                lean=-10 * ease, head_pitch=-20 * ease,
                arm_swing=(40 * ease + 10, 70 * ease + 5), arm_out=(25 + 30 * ease, 20 + 40 * ease),
                elbow=(30, 15))
    return root, pose
