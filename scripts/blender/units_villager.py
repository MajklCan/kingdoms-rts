"""Villager: straw hat with a wide brim, team tunic, linen sleeves, no armour.
Work anims carry their own tool (axe, pickaxe, hammer, hoe, berry basket)."""

from __future__ import annotations

import math

from units_body import Leg, Look, Pose, Puppet, death_root, idle_pose, walk_pose
from units_common import Anim, cycle, keyed, straw_hat, tool_frame, tool_point
from units_rig import Mk, R, T, V

NAME = "villager"
DEF_IDS = ["VILLAGER"]
LOOK = Look(torso="team", sleeve="linen", skirt="team", skirt_len=0.075)

WALK_STRIDE = 0.7

ANIMS = {
    "idle": Anim(frames=4, ms=260),
    "move": Anim(frames=8, stride=WALK_STRIDE),
    "carry_wood": Anim(frames=8, stride=WALK_STRIDE * 0.9),
    "carry_food": Anim(frames=8, stride=WALK_STRIDE * 0.9),
    "carry_gold": Anim(frames=8, stride=WALK_STRIDE * 0.9),
    "carry_stone": Anim(frames=8, stride=WALK_STRIDE * 0.9),
    "chop": Anim(frames=6, ms=110, hit=3),
    "mine": Anim(frames=6, ms=110, hit=3),
    "build": Anim(frames=6, ms=95, hit=2),
    "farm": Anim(frames=6, ms=130, hit=3),
    "forage": Anim(frames=4, ms=170),
    "death": Anim(frames=4, ms=110, once=True, shadow="frame"),
    # aliases for the engine's generic names
    "attack": Anim(alias="chop"),
    "harvest": Anim(alias="chop"),
    "carry": Anim(alias="carry_food"),
}


# -- tools (drawn in a tool frame: +x along the handle) ---------------------------


def axe(mk: Mk) -> None:
    mk.line(V(-0.05, 0, 0), V(0.36, 0, 0), "wood", r=0.017)
    mk.box(V(0.33, 0.0, 0.0), (0.06, 0.04, 0.04), "iron")
    mk.box(V(0.33, 0.055, 0.0), (0.05, 0.07, 0.03), "steel")
    mk.box(V(0.33, 0.1, 0.0), (0.09, 0.03, 0.03), "steel")


def pickaxe(mk: Mk) -> None:
    mk.line(V(-0.05, 0, 0), V(0.36, 0, 0), "wood", r=0.017)
    mk.capsule(V(0.35, 0, 0.0), V(0.33, 0, -0.12), 0.02, 0.012, "iron")
    mk.capsule(V(0.35, 0, 0.0), V(0.33, 0, 0.1), 0.02, 0.014, "iron")


def hammer(mk: Mk) -> None:
    mk.line(V(-0.03, 0, 0), V(0.22, 0, 0), "wood", r=0.016)
    mk.box(V(0.22, 0, -0.01), (0.05, 0.05, 0.1), "iron")


def hoe(mk: Mk) -> None:
    mk.line(V(-0.08, 0, 0), V(0.44, 0, 0), "wood", r=0.016)
    mk.box(V(0.43, 0, -0.05), (0.03, 0.09, 0.08), "steel_d")


def basket(mk: Mk, c, r: float = 0.085, fill: str | None = "berry") -> None:
    c = V(*c)
    mk.cyl(c + V(0, 0, -0.06), c + V(0, 0, 0.05), r, "basket", ref=(1, 0, 0))
    mk.cyl(c + V(0, 0, 0.035), c + V(0, 0, 0.06), r * 1.05, "wood_d", ref=(1, 0, 0))
    if fill == "berry":
        mk.ell(c + V(0, 0, 0.065), (r * 0.85, r * 0.85, 0.035), "berry")
        mk.ell(c + V(0.02, -0.03, 0.09), (0.03, 0.03, 0.025), "leaf")
    elif fill == "gold":
        mk.ell(c + V(0, 0, 0.07), (r * 0.85, r * 0.85, 0.04), "gold")
        mk.box(c + V(0.02, 0.02, 0.1), (0.04, 0.04, 0.03), "gold")
    elif fill == "wheat":
        mk.ell(c + V(0, 0, 0.07), (r * 0.8, r * 0.8, 0.04), "wheat")


# -- poses ------------------------------------------------------------------------


def _work_legs(crouch: float = 0.0, knee: float = 14.0) -> tuple[Leg, Leg]:
    return Leg(thigh=14, knee=knee + 6, spread=0.03), Leg(thigh=-10, knee=knee, spread=0.03)


def _two_handed(pose: Pose, grip, yaw: float, pitch: float, gap: float = 0.11):
    m = tool_frame(V(*grip), yaw, pitch)
    pose.hands = (tool_point(m, gap), V(*grip))
    pose.poles = (V(-0.2, 1.0, -0.9), V(-0.2, -1.0, -0.9))
    return m


CHOP = [  # grip (torso frame), yaw, pitch, twist, lean
    ((-0.02, -0.17, 0.24), -150, 30, -22, 0),
    ((0.0, -0.19, 0.27), -125, 42, -30, -4),
    ((0.12, -0.14, 0.2), -55, 18, -6, 6),
    ((0.17, -0.03, 0.15), 0, 4, 16, 12),
    ((0.15, -0.07, 0.16), -22, 10, 8, 10),
    ((0.06, -0.15, 0.22), -95, 26, -14, 3),
]

MINE = [  # grip, pitch, lean
    ((0.05, -0.05, 0.34), 115, -4),
    ((0.03, -0.05, 0.4), 145, -10),
    ((0.15, -0.05, 0.28), 55, 10),
    ((0.2, -0.05, 0.08), -42, 26),
    ((0.17, -0.05, 0.12), -22, 20),
    ((0.1, -0.05, 0.26), 65, 6),
]

FARM = [
    ((0.1, -0.05, 0.3), 78, 6),
    ((0.1, -0.05, 0.32), 100, 2),
    ((0.17, -0.05, 0.22), 30, 14),
    ((0.2, -0.05, 0.12), -30, 26),
    ((0.14, -0.05, 0.13), -26, 22),
    ((0.1, -0.05, 0.22), 40, 10),
]

BUILD = [  # grip, pitch, lean
    ((0.07, -0.15, 0.37), 105, 14),
    ((0.14, -0.13, 0.27), 40, 20),
    ((0.2, -0.11, 0.12), -35, 28),
    ((0.08, -0.15, 0.36), 100, 16),
    ((0.15, -0.13, 0.26), 35, 22),
    ((0.2, -0.11, 0.12), -35, 28),
]

FORAGE = [  # right hand, lean, berry in hand
    ((0.25, -0.1, 0.02), 30, False),
    ((0.27, -0.05, -0.02), 36, True),
    ((0.13, 0.04, 0.08), 22, True),
    ((0.05, 0.11, 0.06), 14, False),
]


def draw(mk: Mk, anim: str, frame: int) -> None:
    look = LOOK
    tool = None
    tool_m = None
    extra = None
    if anim == "idle":
        pose = idle_pose(cycle(frame, 4))
    elif anim == "move":
        pose = walk_pose(cycle(frame, 8))
    elif anim.startswith("carry_"):
        pose = walk_pose(cycle(frame, 8), stride=26, arm=22, lean=4)
        kind = anim[6:]
        bob = 0.006 * math.cos(4 * math.pi * cycle(frame, 8))
        if kind == "wood":
            pose.hands = (None, V(0.12, -0.17, 0.33 + bob))
            pose.poles = (None, V(-0.5, -1.0, -0.6))
            extra = ("wood", bob)
        else:
            z = 0.1 + bob
            pose.hands = (V(0.17, 0.1, z), V(0.17, -0.1, z))
            pose.poles = (V(-0.4, 1.0, -0.8), V(-0.4, -1.0, -0.8))
            extra = (kind, bob)
    elif anim in ("chop", "mine", "farm", "build"):
        pose = Pose(legs=_work_legs())
        if anim == "chop":
            grip, yaw, pitch, twist, lean = keyed(CHOP, frame)
            pose.twist, pose.lean = twist, lean
            tool_m = _two_handed(pose, grip, yaw, pitch, gap=0.1)
            tool = axe
        elif anim in ("mine", "farm"):
            grip, pitch, lean = keyed(MINE if anim == "mine" else FARM, frame)
            pose.lean = lean
            tool_m = _two_handed(pose, grip, 0, pitch, gap=0.12)
            tool = pickaxe if anim == "mine" else hoe
        else:
            grip, pitch, lean = keyed(BUILD, frame)
            pose.lean = lean
            pose.legs = (Leg(thigh=30, knee=60, spread=0.03), Leg(thigh=-20, knee=70, spread=0.03))
            tool_m = tool_frame(V(*grip), 0, pitch)
            pose.hands = (V(0.22, 0.06, 0.06), V(*grip))
            pose.poles = (V(-0.2, 1.0, -0.9), V(-0.3, -1.0, -0.6))
            tool = hammer
    elif anim == "forage":
        hand, lean, berry = keyed(FORAGE, frame)
        pose = Pose(legs=(Leg(thigh=24, knee=44, spread=0.03), Leg(thigh=-8, knee=30, spread=0.03)), lean=lean)
        pose.hands = (V(0.04, 0.2, 0.0), V(*hand))
        pose.poles = (V(-0.5, 1.0, -0.3), V(-0.2, -1.0, -0.6))
        extra = ("forage", berry)
    elif anim == "death":
        root, pose = death_root(cycle(frame, 4) * 4 / 3)
        pup = Puppet(mk, pose, look, root=root)
        _body(mk, pup)
        return
    else:
        raise KeyError(anim)

    pup = Puppet(mk, pose, look)
    _body(mk, pup)
    if tool is not None:
        with mk.push(pup.torso_m @ tool_m):
            tool(mk)
    if extra is not None:
        kind, arg = extra
        with mk.push(pup.torso_m):
            if kind == "wood":
                for k, (ds, dz) in enumerate(((0.0, 0.0), (-0.05, 0.03), (0.045, 0.035))):
                    c0 = V(-0.16, -0.12 + ds, 0.33 + dz + arg)
                    c1 = V(0.2, -0.12 + ds, 0.33 + dz + arg)
                    mk.cyl(c0, c1, 0.034, "log", ref=(0, 0, 1))
                    mk.cyl(c1 - V(0.012, 0, 0), c1, 0.03, "log_end", ref=(0, 0, 1))
            elif kind == "food":
                basket(mk, (0.2, 0.0, 0.1 + arg), fill="berry")
            elif kind == "gold":
                basket(mk, (0.2, 0.0, 0.1 + arg), fill="gold")
            elif kind == "stone":
                mk.box(V(0.21, 0.0, 0.1 + arg), (0.15, 0.2, 0.13), "stone", rot=R("z", 12))
            elif kind == "forage":
                basket(mk, (0.05, 0.22, 0.02), r=0.075, fill="berry")
                if arg:
                    mk.ell(pup.p.hands[1] + V(0.0, 0, 0.03), 0.03, "berry")


def _body(mk: Mk, pup: Puppet) -> None:
    pup.legs()
    pup.body()
    pup.arm(1)
    pup.arm(-1)
    pup.head()
    straw_hat(mk, pup)


PORTRAIT = {"fit": "head", "density": 4.0, "anim": "idle", "frame": 0, "facing": 1}
