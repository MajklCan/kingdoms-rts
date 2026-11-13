"""Gunman (arquebusier): crested morion with a white plume, steel breastplate
over a team doublet with big team sleeves, a long matchlock. Idle and walk
carry the gun at port arms (diagonal across the chest); attack raises it to
the shoulder, fires (hit frame 3, muzzle flash), recoils and lowers."""

from __future__ import annotations

from units_body import HEAD_R, Leg, Look, Pose, Puppet, death_root, idle_pose, walk_pose
from units_common import Anim, cycle, tool_frame
from units_rig import Mk, V, xfp

NAME = "gunman"
DEF_IDS = ["GUNMAN"]
LOOK = Look(torso="team", sleeve="team", skirt="team", skirt_len=0.07, trousers="leather_d", bulk=1.06,
            beard=True)

ANIMS = {
    "idle": Anim(frames=4, ms=260),
    "move": Anim(frames=8, stride=0.68),
    "attack": Anim(frames=6, ms=100, hit=3),
    "death": Anim(frames=4, ms=110, once=True, shadow="frame"),
}

GUN_LEN = 0.66


def morion(mk: Mk, pup: Puppet) -> None:
    r = HEAD_R
    with mk.push(pup.head_m):
        mk.ell(V(-0.01, 0, r * 0.42), (r * 1.02, r * 1.02, r * 0.86), "steel")
        mk.ell(V(-0.02, 0, r * 0.4), (r * 1.5, r * 1.22, r * 0.11), "steel_d")
        mk.box(V(r * 1.35, 0, r * 0.52), (0.04, r * 0.8, 0.026), "steel_d")
        mk.box(V(-r * 1.5, 0, r * 0.52), (0.04, r * 0.8, 0.026), "steel_d")
        mk.prism([(-r * 0.8, 0.0), (r * 0.7, 0.0), (r * 0.4, r * 0.45), (-r * 0.5, r * 0.5)],
                 V(0, 0, r * 1.1), V(1, 0, 0), V(0, 0, 1), 0.026, "steel")
        mk.capsule(V(-r * 0.6, 0, r * 1.4), V(-r * 1.2, 0, r * 1.95), 0.034, 0.018, "team")


def breastplate(mk: Mk, pup: Puppet) -> None:
    with mk.push(pup.torso_m):
        mk.ell(V(0.03, 0, 0.14), (0.08, 0.128, 0.14), "steel")
        mk.box(V(0.1, 0, 0.14), (0.02, 0.02, 0.2), "steel_d")
        mk.capsule(V(0.0, 0, 0.05), V(0, 0, 0.02), 0.106, 0.108, "leather_d", caps=False)


def gun(mk: Mk, flash: bool = False) -> None:
    """Musket frame: origin at the butt, +x towards the muzzle."""
    mk.box(V(0.08, 0, -0.005), (0.17, 0.045, 0.07), "wood")
    mk.box(V(0.3, 0, 0.0), (0.3, 0.035, 0.035), "wood")
    mk.line(V(0.12, 0, 0.03), V(GUN_LEN, 0, 0.03), "black_iron", r=0.017)
    mk.box(V(0.2, 0, 0.0), (0.04, 0.05, 0.02), "iron")
    if flash:
        mk.ell(V(GUN_LEN + 0.06, 0, 0.03), (0.07, 0.05, 0.05), "flash")
        mk.ell(V(GUN_LEN + 0.12, 0, 0.03), (0.04, 0.03, 0.03), "spark")


ATTACK = [  # butt (torso frame), yaw, pitch, lean, head pitch
    (V(0.1, -0.12, 0.08), 28, 50, 2, 0),
    (V(0.05, -0.1, 0.2), 8, 15, 2, 6),
    (V(0.02, -0.08, 0.27), 0, 0, 4, 10),
    (V(0.02, -0.08, 0.27), 0, 0, 4, 10),
    (V(-0.03, -0.09, 0.29), 0, 16, -8, 0),
    (V(0.06, -0.11, 0.18), 18, 34, 0, 0),
]


def draw(mk: Mk, anim: str, frame: int) -> None:
    look = LOOK
    if anim == "death":
        root, pose = death_root(cycle(frame, 4) * 4 / 3)
        pup = Puppet(mk, pose, look, root=root)
        _body(mk, pup)
        return
    flash = False
    if anim in ("idle", "move"):
        pose = idle_pose(cycle(frame, 4)) if anim == "idle" else walk_pose(cycle(frame, 8), stride=28, arm=10)
        butt, yaw, pitch = V(0.11, -0.13, 0.04), 30.0, 55.0
        lean_head = 0.0
    else:
        butt, yaw, pitch, lean, lean_head = ATTACK[frame % 6]
        pose = Pose(legs=(Leg(thigh=22, knee=12, spread=0.03), Leg(thigh=-18, knee=6, spread=0.03)),
                    lean=lean, twist=-6, head_pitch=lean_head)
        flash = frame % 6 == 3
    m = tool_frame(butt, yaw, pitch)
    pose.hands = (xfp(m, V(0.34, 0.0, -0.02)), xfp(m, V(0.13, 0.0, -0.03)))
    pose.poles = (V(-0.3, 1.0, -0.8), V(-0.3, -1.0, -0.8))
    pup = Puppet(mk, pose, look)
    _body(mk, pup)
    with mk.push(pup.torso_m @ m):
        gun(mk, flash)
    mk.mark("muzzle", xfp(pup.torso_m, xfp(m, V(GUN_LEN + 0.02, 0, 0.03))))


def _body(mk: Mk, pup: Puppet) -> None:
    pup.legs()
    pup.body()
    breastplate(mk, pup)
    pup.arm(1)
    pup.arm(-1)
    pup.head()
    morion(mk, pup)


PORTRAIT = {"fit": "head", "density": 4.0, "anim": "idle", "frame": 0, "facing": 1}
