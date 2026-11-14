"""Shared bits of the unit definitions: animation specs, tool frames, hats."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from units_body import HEAD_R, Puppet
from units_rig import Mk, R, T, V, xfp


@dataclass(frozen=True)
class Anim:
    """One animation of a unit.

    frames: frame count. Timing for the engine:
      stride   tiles travelled per full cycle (walk-type anims, distance driven)
      ms       ms per frame (time driven loops and one-shots)
      hit      attack anims: frame on which the blow lands / the shot leaves
      once     play once and hold the last frame (death)
      shadow   'static' = one shadow per facing (from frame 0), 'frame' = per frame
      alias    reuse another anim's frames (no extra atlas space)
    """

    frames: int = 1
    stride: float = 0.0
    ms: float = 0.0
    hit: int = -1
    once: bool = False
    shadow: str = "static"
    alias: str = ""


def tool_frame(grip: np.ndarray, yaw: float, pitch: float, roll: float = 0.0) -> np.ndarray:
    """Tool frame: origin at the grip, local +x along the handle (towards the head).
    yaw turns left, pitch raises the head, roll spins it about the handle."""
    return T(*grip) @ R("z", yaw) @ R("s", -pitch) @ R("f", roll)


def tool_point(m: np.ndarray, x: float) -> np.ndarray:
    return xfp(m, V(x, 0.0, 0.0))


def two_hand(p_grip: np.ndarray, m: np.ndarray, gap: float = 0.1) -> tuple[np.ndarray, np.ndarray]:
    """(right hand, left hand) torso-frame targets on a handle."""
    return p_grip, tool_point(m, gap)


def straw_hat(mk: Mk, pup: Puppet, tilt: float = 0.0, key: str = "straw_hat", trim: str = "straw_d") -> None:
    r = HEAD_R
    with mk.push(pup.head_m @ R("s", tilt)):
        mk.capsule(V(-0.004, 0, r * 0.42), V(-0.004, 0, r * 0.62), r * 1.72, r * 1.62, key, caps=False)
        mk.capsule(V(-0.004, 0, r * 0.6), V(-0.004, 0, r * 1.2), r * 0.98, r * 0.66, key, caps=False)
        mk.ell(V(-0.004, 0, r * 1.18), (r * 0.66, r * 0.66, r * 0.2), key)
        mk.capsule(V(-0.004, 0, r * 0.62), V(-0.004, 0, r * 0.78), r * 0.99, r * 0.97, trim, caps=False)


def kettle_hat(mk: Mk, pup: Puppet) -> None:
    r = HEAD_R
    with mk.push(pup.head_m):
        mk.ell(V(-0.006, 0, r * 0.2), (r * 1.08, r * 1.08, r * 1.04), "steel")
        mk.capsule(V(-0.006, 0, r * 0.12), V(-0.006, 0, r * 0.3), r * 1.62, r * 1.5, "steel", caps=False)
        mk.capsule(V(-0.006, 0, r * 0.12), V(-0.006, 0, r * 0.2), r * 1.64, r * 1.62, "steel_d", caps=False)


def cycle(frame: int, frames: int) -> float:
    return (frame % frames) / frames


def lerp(a, b, t: float):
    return a + (b - a) * t


def keyed(keys: list, frame: int):
    return keys[frame % len(keys)]


def ease(t: float) -> float:
    return t * t * (3 - 2 * t)


def deg_vec(yaw: float, pitch: float) -> np.ndarray:
    y, p = math.radians(yaw), math.radians(pitch)
    return np.array([math.cos(y) * math.cos(p), math.sin(y) * math.cos(p), math.sin(p)])
