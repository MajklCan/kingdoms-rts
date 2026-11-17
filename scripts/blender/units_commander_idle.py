"""Commander idle gags: `idle-smoke` rolls a cigarette, lights it and smokes
(24 frames, loops), `idle-sit` sits down, looks about and stands up again
(12 frames). Both keep the sword sheathed. Which one plays, and when, is
decided render-side (src/render/entities/commander-idle.ts)."""

from __future__ import annotations

import math

import numpy as np

from units_body import HEAD_R, Leg, Pose, Puppet
from units_commander_kit import LOOK, cloak, finish_head, scabbard, tabard
from units_rig import Mk, V, xfp

SMOKE_FRAMES = 24
SIT_FRAMES = 12

# smoke phases by frame: roll 0-5, lick 6, light 7-9, drag 10-12, exhale 13-16,
# hand down 17-19, second drag 20-21, exhale 22-23
LEFT_ROLL = V(0.14, 0.05, 0.1)
RIGHT_ROLL = V(0.14, -0.04, 0.1)
MOUTH_HAND = V(0.125, -0.045, 0.335)
LOW_HAND = V(0.1, -0.2, 0.02)
LIGHT_HAND = V(0.12, 0.045, 0.325)
HIP_HAND = V(0.1, 0.17, 0.0)
EXHALE_HAND = V(0.12, -0.1, 0.25)


def _smoke_pose(f: int) -> tuple[Pose, str]:
    """Pose and phase name for one frame of the smoke loop."""
    p = Pose(legs=(Leg(thigh=3, knee=6, spread=0.012), Leg(thigh=-3, knee=6, spread=0.012)))
    p.poles = (V(-0.3, 1.0, -0.8), V(-0.3, -1.0, -0.8))
    if f < 6:  # roll: both hands work in front of the belt, head down
        k = 0.012 * math.sin(f * 1.9)
        p.hands = (LEFT_ROLL + V(0, 0, -k), RIGHT_ROLL + V(k, 0, k))
        p.head_pitch = 18
        p.lean = 4
        return p, "roll"
    if f == 6:  # lick the paper
        p.hands = (LEFT_ROLL + V(0, 0.01, 0.1), RIGHT_ROLL + V(0.0, 0.03, 0.22))
        p.head_pitch = 10
        return p, "lick"
    if f < 10:  # light: left hand cups the flame at the mouth
        p.hands = (LIGHT_HAND, MOUTH_HAND + V(0, 0.01, -0.005))
        p.head_pitch = 12
        return p, "light"
    if f < 13:  # drag, chest rises
        p.hands = (HIP_HAND, MOUTH_HAND)
        p.lean = -2
        p.head_pitch = -6
        return p, "drag"
    if f < 17:  # exhale, head back
        p.hands = (HIP_HAND, EXHALE_HAND if f > 14 else MOUTH_HAND + V(0, -0.02, -0.04))
        p.head_pitch = -14
        p.lean = -4
        return p, "exhale"
    if f < 20:  # cigarette held low, looking around
        p.hands = (HIP_HAND, LOW_HAND)
        p.head_yaw = (-14, 0, 14)[f - 17]
        return p, "low"
    if f < 22:
        p.hands = (HIP_HAND, MOUTH_HAND)
        p.head_pitch = -4
        return p, "drag"
    p.hands = (HIP_HAND, EXHALE_HAND if f == 22 else LOW_HAND + V(0.03, 0.04, 0.2))
    p.head_pitch = -14
    return p, "exhale"


def _mouth(pup: Puppet) -> np.ndarray:
    return xfp(pup.head_m, V(HEAD_R + 0.03, -0.02, -HEAD_R * 0.3))


def _cigarette(mk: Mk, start: np.ndarray, direction: np.ndarray, ember: bool = True) -> np.ndarray:
    d = direction / np.linalg.norm(direction)
    end = start + d * 0.07
    mk.capsule(start, end, 0.011, 0.011, "fletch", caps=False)
    if ember:
        mk.ell(end + d * 0.006, 0.012, "spark")
    return end


def _wisp(mk: Mk, origin: np.ndarray, age: float, n: int = 4) -> None:
    """A curl of smoke rising from `origin`; age 0..1 grows and lifts it."""
    for i in range(n):
        t = age + i * 0.22
        pos = origin + V(0.03 + 0.04 * t, 0.025 * math.sin(t * 7), 0.07 + 0.2 * t)
        mk.ell(pos, 0.02 + 0.018 * t, "smoke")


def draw_smoke(mk: Mk, frame: int) -> None:
    frame %= SMOKE_FRAMES
    pose, phase = _smoke_pose(frame)
    pup = Puppet(mk, pose, LOOK)
    pup.legs()
    pup.body()
    tabard(mk, pup)
    cloak(mk, pup)
    scabbard(mk, pup, with_sword=True)
    pup.arm(1)
    pup.arm(-1)
    finish_head(mk, pup)
    rh, lh = pup.hand_pts[-1], pup.hand_pts[1]
    mouth = _mouth(pup)
    if phase in ("roll", "lick"):
        mk.box((rh + lh) / 2 + V(0.0, 0, 0.012), (0.07, 0.022, 0.012), "fletch")
    elif phase == "light":
        _cigarette(mk, mouth + V(-0.015, 0, 0), V(1, 0.15, 0), ember=frame >= 8)
        mk.ell(mouth + V(0.07, 0.03, 0.0), 0.016 if frame == 7 else 0.011, "flash")
    elif phase == "drag":
        _cigarette(mk, rh, V(1, 0.2, 0.3))
    elif phase == "exhale":
        _cigarette(mk, rh, V(1, 0.2, 0.5))
        _wisp(mk, mouth + V(0.02, 0, 0.0), (frame - 13) / 6.0 if frame < 17 else (frame - 22) / 3.0)
    else:  # low
        end = _cigarette(mk, rh, V(0.8, 0.1, 0.6))
        _wisp(mk, end, (frame - 17) / 5.0, n=2)


def _sit_pose(f: int) -> Pose:
    seats = [0.22, 0.14, 0.075] + [0.075] * 6 + [0.14, 0.22, 0.26]
    thighs = [30, 60, 80] + [80] * 6 + [60, 30, 10]
    knees = [40, 30, 8] + [8] * 6 + [30, 40, 10]
    p = Pose(legs=(Leg(thigh=thighs[f], knee=knees[f], spread=0.06),
                   Leg(thigh=thighs[f] - 4, knee=knees[f], spread=0.06)))
    p.seat = seats[f]
    if 2 <= f <= 8:
        p.hands = (V(0.17, 0.1, -0.01), V(0.17, -0.1, -0.01))
        p.lean = 4
        p.head_yaw = (0, -18, -18, 0, 18, 18, 0)[f - 2]
        p.head_pitch = 4 if f in (3, 4) else 0
    else:
        p.lean = 8 if f in (1, 10) else 3
        p.hands = (V(0.14, 0.12, 0.02), V(0.14, -0.12, 0.02))
    p.poles = (V(-0.3, 1.0, -0.8), V(-0.3, -1.0, -0.8))
    return p


def draw_sit(mk: Mk, frame: int) -> None:
    pup = Puppet(mk, _sit_pose(frame % SIT_FRAMES), LOOK)
    pup.legs()
    pup.body()
    tabard(mk, pup)
    cloak(mk, pup, sway=0.02)
    scabbard(mk, pup, with_sword=True)
    pup.arm(1)
    pup.arm(-1)
    finish_head(mk, pup)
