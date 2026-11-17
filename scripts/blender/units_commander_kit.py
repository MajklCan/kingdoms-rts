"""Commander gear shared by his normal and idle poses: felt hat with a white
plume, grey moustache, blue cloak and tabard, belt sword and scabbard."""

from __future__ import annotations

import math

from units_body import HEAD_R, Look, Puppet
from units_common import tool_frame
from units_rig import Mk, V, xfp

LOOK = Look(torso="leather", sleeve="linen_d", skirt="team", skirt_len=0.1, belt="leather_d",
            hair="grey", bulk=1.1)


def hat(mk: Mk, pup: Puppet) -> None:
    """Felt hat with a short brim, a leather band and a white plume swept back on the left."""
    r = HEAD_R
    with mk.push(pup.head_m):
        mk.capsule(V(-0.01, 0, r * 0.48), V(-0.01, 0, r * 0.6), r * 1.42, r * 1.34, "felt", caps=False)
        mk.capsule(V(-0.01, 0, r * 0.55), V(-0.01, 0, r * 1.15), r * 1.02, r * 0.82, "felt", caps=False)
        mk.ell(V(-0.01, 0, r * 1.13), (r * 0.82, r * 0.82, r * 0.2), "felt")
        mk.capsule(V(-0.01, 0, r * 0.6), V(-0.01, 0, r * 0.78), r * 1.03, r * 1.01, "leather_d", caps=False)
        mk.capsule(V(-0.03, 0.1, r * 0.95), V(-0.12, 0.13, r * 1.95), 0.05, 0.026, "plume")
        mk.capsule(V(-0.12, 0.13, r * 1.95), V(-0.24, 0.14, r * 1.6), 0.03, 0.014, "plume")


def moustache(mk: Mk, pup: Puppet) -> None:
    r = HEAD_R
    with mk.push(pup.head_m):
        mk.box(V(r * 0.97, 0.0, -r * 0.2), (0.036, 0.11, 0.03), "grey")
        for side in (1, -1):
            mk.box(V(r * 0.9, side * 0.062, -r * 0.34), (0.03, 0.026, 0.05), "grey")


def tabard(mk: Mk, pup: Puppet) -> None:
    with mk.push(pup.torso_m):
        mk.ell(V(0.006, 0, 0.13), (0.1, 0.108, 0.155), "team")
        mk.capsule(V(0.0, 0, 0.07), V(0.0, 0, -0.07), 0.108, 0.124, "team", caps=False)
        mk.box(V(0.108, 0, 0.1), (0.026, 0.05, 0.05), "gold")  # clasp


def cloak(mk: Mk, pup: Puppet, sway: float = 0.0) -> None:
    """Cape behind the shoulders; `sway` pushes the hem back (tiles) while walking."""
    with mk.push(pup.torso_m):
        mk.capsule(V(-0.01, -0.15, 0.225), V(-0.01, 0.15, 0.225), 0.05, 0.05, "team", caps=False)
        upper = [(-0.16, 0.22), (0.16, 0.22), (0.19, 0.04), (-0.19, 0.04)]
        lower = [(-0.19, 0.06), (0.19, 0.06), (0.21, -0.17), (-0.21, -0.17)]
        mk.prism(upper, V(-0.115, 0, 0), V(0, 1, 0), V(0, 0, 1), 0.03, "team")
        mk.prism(lower, V(-0.125 - sway, 0, 0), V(0, 1, 0), V(0, 0, 1), 0.03, "team")
        mk.box(V(-0.11, 0, 0.215), (0.04, 0.3, 0.02), "team_trim")  # edge of the collar


def scabbard(mk: Mk, pup: Puppet, with_sword: bool) -> None:
    """Hip scabbard at the left; the hilt shows when the sword is sheathed."""
    with mk.push(pup.torso_m):
        a, b = V(0.02, 0.13, 0.04), V(-0.2, 0.15, -0.1)
        mk.capsule(a, b, 0.024, 0.018, "leather_d")
        mk.box(V(-0.205, 0.15, -0.105), (0.04, 0.04, 0.03), "gold")
        if with_sword:
            mk.capsule(a, a + V(0.04, -0.005, 0.05), 0.016, 0.016, "leather_d")
            mk.box(a + V(0.05, -0.006, 0.07), (0.02, 0.1, 0.02), "gold")
            mk.ell(a + V(0.075, -0.008, 0.1), 0.02, "gold")


def sword(mk: Mk, pup: Puppet, ang: float) -> None:
    """Drawn arming sword in the right hand, blade `ang` degrees above the horizon."""
    g = pup.p.hands[1]
    with mk.push(pup.torso_m @ tool_frame(g, 0, ang)):
        mk.box(V(-0.03, 0, 0), (0.06, 0.03, 0.03), "leather_d")
        mk.ell(V(-0.065, 0, 0), 0.026, "gold")
        mk.box(V(0.03, 0, 0), (0.03, 0.17, 0.04), "gold")
        mk.box(V(0.24, 0, 0), (0.42, 0.05, 0.026), "steel")
        mk.box(V(0.24, 0, -0.012), (0.4, 0.034, 0.012), "steel_d")


def tip_point(pup: Puppet, ang: float):
    g = pup.p.hands[1]
    return xfp(pup.torso_m @ tool_frame(g, 0, ang), V(0.45, 0, 0))


def finish_head(mk: Mk, pup: Puppet) -> None:
    pup.head()
    moustache(mk, pup)
    hat(mk, pup)


def sway_of(phase: float) -> float:
    return 0.035 * (0.5 - 0.5 * math.cos(4 * math.pi * phase))
