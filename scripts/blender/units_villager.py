"""Villagers: one shared body, one kit per role.

The base `villager` unit is the builder, the free universal villager from the
town centre: wide rust beret, beard, rolled sleeves, leather
apron, mallet on the shoulder, hammer on the belt and a saw on his back. He has
every work anim.

Worksite crews are their own atlas units (`villager-<role>`, manifest `look`)
with only the anims their job plays; the engine falls back to the builder for
anything else (docs/UNIT_SPRITES.md, "Villager roles"):

    lumberjack   moss wool cap on a fur brim, fur collar, bulkier, felling axe
    farmer       wide straw hat, light linen trousers, hoe on the shoulder
    quarryman    grey visor cap, dusty sleeves and apron, beard, big pick
    gold-miner   white miner's hood, leather seat patch, lit lamp at the belt, pick

Every role keeps the team tunic and skirt in the same place, so team colour
reads the same on all of them. Tools in work anims are the same as before.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Callable

from units_body import HEAD_R, Leg, Look, Pose, Puppet, death_root, idle_pose, walk_pose
from units_common import Anim, cycle, keyed, straw_hat, tool_frame, tool_point
from units_rig import Mk, R, V

NAME = "villager"
DEF_IDS = ["VILLAGER"]

WALK_STRIDE = 0.7

# One spec per anim, shared by every role so frame counts and timing match.
SPECS = {
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
}


def _anims(names: list[str], aliases: dict[str, str]) -> dict[str, Anim]:
    out = {n: SPECS[n] for n in names}
    out.update({k: Anim(alias=v) for k, v in aliases.items()})
    return out


ANIMS = _anims(list(SPECS), {"attack": "chop", "harvest": "chop", "carry": "carry_food"})


# -- tools (drawn in a tool frame: +x along the handle) ---------------------------


def axe(mk: Mk) -> None:
    mk.line(V(-0.05, 0, 0), V(0.36, 0, 0), "wood", r=0.017)
    mk.box(V(0.33, 0.0, 0.0), (0.06, 0.04, 0.04), "iron")
    mk.box(V(0.33, 0.055, 0.0), (0.05, 0.07, 0.03), "steel")
    mk.box(V(0.33, 0.1, 0.0), (0.09, 0.03, 0.03), "steel")


def felling_axe(mk: Mk) -> None:
    """The lumberjack's axe: longer haft, a broad bit that reads at 1x."""
    mk.line(V(-0.06, 0, 0), V(0.42, 0, 0), "wood_l", r=0.018)
    mk.box(V(0.39, 0.0, 0.0), (0.07, 0.05, 0.045), "iron")
    mk.box(V(0.39, 0.065, 0.0), (0.07, 0.08, 0.035), "steel")
    mk.box(V(0.39, 0.115, 0.0), (0.12, 0.035, 0.035), "steel")


def pickaxe(mk: Mk) -> None:
    mk.line(V(-0.05, 0, 0), V(0.36, 0, 0), "wood", r=0.017)
    mk.capsule(V(0.35, 0, 0.0), V(0.33, 0, -0.12), 0.02, 0.012, "iron")
    mk.capsule(V(0.35, 0, 0.0), V(0.33, 0, 0.1), 0.02, 0.014, "iron")


def big_pick(mk: Mk) -> None:
    """Shouldered miner's pick: a heavier, longer head than the work pick."""
    mk.line(V(-0.06, 0, 0), V(0.4, 0, 0), "wood", r=0.018)
    mk.capsule(V(0.39, 0, 0.0), V(0.35, 0, -0.15), 0.025, 0.012, "iron")
    mk.capsule(V(0.39, 0, 0.0), V(0.35, 0, 0.13), 0.025, 0.014, "iron")


def hammer(mk: Mk) -> None:
    mk.line(V(-0.03, 0, 0), V(0.22, 0, 0), "wood", r=0.016)
    mk.box(V(0.22, 0, -0.01), (0.05, 0.05, 0.1), "iron")


def mallet(mk: Mk) -> None:
    """The builder's wooden beetle for construction work."""
    mk.line(V(-0.03, 0, 0), V(0.22, 0, 0), "wood_d", r=0.016)
    mk.cyl(V(0.22, 0, -0.06), V(0.22, 0, 0.05), 0.045, "wood_l", ref=(1, 0, 0))


def big_mallet(mk: Mk) -> None:
    """Shouldered beetle: long haft, a fat banded head."""
    mk.line(V(-0.05, 0, 0), V(0.34, 0, 0), "wood_d", r=0.017)
    mk.cyl(V(0.34, 0, -0.085), V(0.34, 0, 0.085), 0.062, "wood_l", ref=(1, 0, 0))
    mk.cyl(V(0.34, 0, -0.085), V(0.34, 0, -0.06), 0.066, "iron", ref=(1, 0, 0))
    mk.cyl(V(0.34, 0, 0.06), V(0.34, 0, 0.085), 0.066, "iron", ref=(1, 0, 0))


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


# -- headwear and gear (one per role) ---------------------------------------------


def felt_cap(mk: Mk, pup: Puppet) -> None:
    """Builder: wide rust beret slumped to one side over a dark headband."""
    r = HEAD_R
    with mk.push(pup.head_m):
        mk.capsule(V(-0.01, 0, r * 0.3), V(-0.01, 0, r * 0.5), r * 1.04, r * 1.02, "cap_d", caps=False)
        with mk.push(R("f", 14) @ R("s", -10)):
            mk.ell(V(-0.02, 0.02, r * 0.78), (r * 1.3, r * 1.36, r * 0.42), "cap")
        mk.ell(V(-0.02, 0.0, r * 1.12), (r * 0.16, r * 0.16, r * 0.14), "cap_d")


def fur_cap(mk: Mk, pup: Puppet) -> None:
    """Lumberjack: tall moss green wool cap over a thick fur brim."""
    r = HEAD_R
    with mk.push(pup.head_m):
        mk.ell(V(-0.02, 0, r * 0.75), (r * 1.0, r * 1.02, r * 0.95), "moss")
        mk.capsule(V(-0.012, 0, r * 0.18), V(-0.012, 0, r * 0.55), r * 1.24, r * 1.26, "fur_l", caps=False)


def skull_cap(mk: Mk, pup: Puppet) -> None:
    """Quarryman: grey felt cap with a stiff visor, stone dust all over."""
    r = HEAD_R
    with mk.push(pup.head_m):
        mk.ell(V(-0.02, 0, r * 0.42), (r * 1.08, r * 1.08, r * 0.8), "dust", clip_lo=(-1, -1, 0.0))
        mk.capsule(V(-0.012, 0, r * 0.32), V(-0.012, 0, r * 0.5), r * 1.1, r * 1.08, "dust_d", caps=False)
        mk.box(V(r * 1.05, 0, r * 0.42), (r * 0.8, r * 1.5, 0.03), "dust_d")


def miner_hood(mk: Mk, pup: Puppet) -> None:
    """Gold miner: the white hood of the old ore miners, short shoulder cape."""
    r = HEAD_R
    with mk.push(pup.head_m):
        mk.ell(V(-0.03, 0, r * 0.12), (r * 1.12, r * 1.12, r * 1.14), "miner_white")
        mk.box(V(r * 0.64, 0, r * 0.6), (0.03, r * 1.3, 0.03), "dust")
    with mk.push(pup.torso_m):
        mk.capsule(V(-0.005, 0, 0.28), V(-0.01, 0, 0.21), 0.08, 0.145, "miner_white", caps=False)


def farmer_hat(mk: Mk, pup: Puppet) -> None:
    straw_hat(mk, pup)


def builder_gear(mk: Mk, pup: Puppet, anim: str) -> None:
    with mk.push(pup.torso_m):
        # leather waist apron over the front of the skirt
        mk.box(V(0.1, 0, -0.035), (0.03, 0.17, 0.19), "leather")
        mk.box(V(0.1, 0, 0.055), (0.035, 0.18, 0.025), "leather_d")
        # hammer hanging at the left hip, head up
        mk.line(V(0.03, 0.125, 0.03), V(0.03, 0.13, -0.11), "wood_d", r=0.014)
        mk.box(V(0.03, 0.125, 0.045), (0.1, 0.045, 0.045), "iron")
        if anim != "death":
            # saw across the back
            with mk.push(R("f", 34)):
                mk.box(V(-0.115, 0.0, 0.17), (0.028, 0.08, 0.27), "steel")
                mk.box(V(-0.115, 0.0, 0.32), (0.04, 0.06, 0.05), "wood")


def lumberjack_gear(mk: Mk, pup: Puppet, anim: str) -> None:
    with mk.push(pup.torso_m):
        mk.capsule(V(-0.005, 0, 0.29), V(-0.01, 0, 0.22), 0.09, 0.16, "fur_l", caps=False)


def farmer_gear(mk: Mk, pup: Puppet, anim: str) -> None:
    with mk.push(pup.torso_m):
        # sickle at the left hip
        mk.line(V(0.04, 0.118, 0.02), V(0.04, 0.12, -0.06), "wood", r=0.014)
        mk.capsule(V(0.04, 0.12, -0.06), V(0.1, 0.12, -0.12), 0.014, 0.01, "steel")


def quarry_gear(mk: Mk, pup: Puppet, anim: str) -> None:
    with mk.push(pup.torso_m):
        mk.box(V(0.1, 0, -0.035), (0.03, 0.17, 0.19), "dust_d")


def miner_gear(mk: Mk, pup: Puppet, anim: str) -> None:
    with mk.push(pup.torso_m):
        # leather seat patch at the back, lamp at the left hip
        mk.box(V(-0.105, 0, -0.04), (0.03, 0.2, 0.18), "leather_d")
        mk.box(V(0.05, 0.12, -0.02), (0.06, 0.05, 0.07), "iron")
        mk.box(V(0.075, 0.125, -0.02), (0.02, 0.035, 0.04), "lamp")


# -- kits ------------------------------------------------------------------------------


@dataclass(frozen=True)
class Kit:
    role: str
    look: Look
    hat: Callable[[Mk, Puppet], None]
    gear: Callable[[Mk, Puppet, str], None] | None = None
    #: tool resting on the right shoulder in idle and move (None = hands free)
    shoulder: Callable[[Mk], None] | None = None
    #: blade roll of the shouldered tool about its handle (deg)
    shoulder_roll: float = 0.0
    tools: dict[str, Callable[[Mk], None]] = field(default_factory=dict)


BASE_TOOLS = {"chop": axe, "mine": pickaxe, "farm": hoe, "build": mallet}

BUILDER = Kit(
    role="builder",
    look=Look(torso="team", sleeve="linen", skirt="team", skirt_len=0.075, beard=True, forearm="skin",
              hair="hair_l"),
    hat=felt_cap,
    gear=builder_gear,
    shoulder=big_mallet,
)
LUMBERJACK = Kit(
    role="lumberjack",
    look=Look(torso="team", sleeve="tunic", skirt="team", skirt_len=0.06, trousers="leather_d", beard=True,
              bulk=1.12),
    hat=fur_cap,
    gear=lumberjack_gear,
    shoulder=felling_axe,
    shoulder_roll=90.0,
    tools={"chop": felling_axe},
)
FARMER = Kit(
    role="farmer",
    look=Look(torso="team", sleeve="linen", skirt="team", skirt_len=0.075, trousers="linen_d", forearm="skin"),
    hat=farmer_hat,
    gear=farmer_gear,
    shoulder=hoe,
    shoulder_roll=180.0,
)
QUARRYMAN = Kit(
    role="quarryman",
    look=Look(torso="team", sleeve="dust", skirt="team", skirt_len=0.075, trousers="dust_d", forearm="skin",
              bulk=1.06, beard=True),
    hat=skull_cap,
    gear=quarry_gear,
    shoulder=big_pick,
    shoulder_roll=90.0,
)
GOLD_MINER = Kit(
    role="gold-miner",
    look=Look(torso="team", sleeve="felt", skirt="team", skirt_len=0.075, trousers="felt", hair=None),
    hat=miner_hood,
    gear=miner_gear,
    shoulder=big_pick,
    shoulder_roll=90.0,
)


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

#: right-hand grip of a shouldered tool (torso frame); the haft runs up and back over the shoulder
SHOULDER_GRIP = (0.13, -0.16, 0.17)
SHOULDER_YAW = 180.0
SHOULDER_PITCH = 50.0


def draw_kit(kit: Kit, mk: Mk, anim: str, frame: int) -> None:
    look = kit.look
    tool = None
    tool_m = None
    extra = None
    if anim in ("idle", "move"):
        pose = idle_pose(cycle(frame, 4)) if anim == "idle" else walk_pose(cycle(frame, 8))
        if kit.shoulder is not None:
            bob = 0.0 if anim == "idle" else 0.006 * math.cos(4 * math.pi * cycle(frame, 8))
            grip = V(SHOULDER_GRIP[0], SHOULDER_GRIP[1], SHOULDER_GRIP[2] + bob)
            tool_m = tool_frame(grip, SHOULDER_YAW, SHOULDER_PITCH, kit.shoulder_roll)
            pose.hands = (pose.hands[0], grip)
            pose.poles = (pose.poles[0], V(-0.3, -1.0, -0.9))
            tool = kit.shoulder
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
        tool = kit.tools.get(anim, BASE_TOOLS[anim])
        if anim == "chop":
            grip, yaw, pitch, twist, lean = keyed(CHOP, frame)
            pose.twist, pose.lean = twist, lean
            tool_m = _two_handed(pose, grip, yaw, pitch, gap=0.1)
        elif anim in ("mine", "farm"):
            grip, pitch, lean = keyed(MINE if anim == "mine" else FARM, frame)
            pose.lean = lean
            tool_m = _two_handed(pose, grip, 0, pitch, gap=0.12)
        else:
            grip, pitch, lean = keyed(BUILD, frame)
            pose.lean = lean
            pose.legs = (Leg(thigh=30, knee=60, spread=0.03), Leg(thigh=-20, knee=70, spread=0.03))
            tool_m = tool_frame(V(*grip), 0, pitch)
            pose.hands = (V(0.22, 0.06, 0.06), V(*grip))
            pose.poles = (V(-0.2, 1.0, -0.9), V(-0.3, -1.0, -0.6))
    elif anim == "forage":
        hand, lean, berry = keyed(FORAGE, frame)
        pose = Pose(legs=(Leg(thigh=24, knee=44, spread=0.03), Leg(thigh=-8, knee=30, spread=0.03)), lean=lean)
        pose.hands = (V(0.04, 0.2, 0.0), V(*hand))
        pose.poles = (V(-0.5, 1.0, -0.3), V(-0.2, -1.0, -0.6))
        extra = ("forage", berry)
    elif anim == "death":
        root, pose = death_root(cycle(frame, 4) * 4 / 3)
        pup = Puppet(mk, pose, look, root=root)
        _body(kit, mk, pup, anim)
        return
    else:
        raise KeyError(anim)

    pup = Puppet(mk, pose, look)
    _body(kit, mk, pup, anim)
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


def _body(kit: Kit, mk: Mk, pup: Puppet, anim: str) -> None:
    pup.legs()
    pup.body()
    if kit.gear is not None:
        kit.gear(mk, pup, anim)
    pup.arm(1)
    pup.arm(-1)
    pup.head()
    kit.hat(mk, pup)


def draw(mk: Mk, anim: str, frame: int) -> None:
    draw_kit(BUILDER, mk, anim, frame)


PORTRAIT = {"fit": "head", "density": 4.0, "anim": "idle", "frame": 0, "facing": 1}


def _role_unit(kit: Kit, work: list[str], aliases: dict[str, str]) -> SimpleNamespace:
    """A worksite crew as its own atlas unit: only the anims the job plays."""
    return SimpleNamespace(
        NAME=f"villager-{kit.role}",
        DEF_IDS=DEF_IDS,
        LOOK=kit.role,
        ANIMS=_anims(["idle", "move", *work, "death"], aliases),
        draw=lambda mk, anim, frame: draw_kit(kit, mk, anim, frame),
        PORTRAIT=PORTRAIT,
    )


#: role name -> unit namespace (render_units.py names them "villager-<role>")
ROLE_UNITS = {
    "lumberjack": _role_unit(LUMBERJACK, ["carry_wood", "chop"],
                             {"attack": "chop", "harvest": "chop", "carry": "carry_wood"}),
    "farmer": _role_unit(FARMER, ["carry_food", "farm"], {"harvest": "farm", "carry": "carry_food"}),
    "quarryman": _role_unit(QUARRYMAN, ["carry_stone", "mine"], {"harvest": "mine", "carry": "carry_stone"}),
    "gold-miner": _role_unit(GOLD_MINER, ["carry_gold", "mine"], {"harvest": "mine", "carry": "carry_gold"}),
}
