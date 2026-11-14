"""Militia (legacy, no longer trainable): the pikeman's body, tabard and shield
with a short arming sword instead of the pike."""

from __future__ import annotations

from units_spearman import ANIMS, LOOK, PORTRAIT, draw_militia

NAME = "militia"
DEF_IDS = ["MILITIA"]
__all__ = ["ANIMS", "DEF_IDS", "LOOK", "NAME", "PORTRAIT", "draw"]


def draw(mk, anim: str, frame: int) -> None:
    draw_militia(mk, anim, frame)
