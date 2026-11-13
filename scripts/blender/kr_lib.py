"""Shared Blender library for the Kingdoms RTS sprite pipeline.

Camera, sun, render settings, multi-pass extraction (beauty, team mask,
shadow) and the procedural material library live here. Asset families
(`buildings.py`, `nature.py`, `terrain.py`, `decor.py`) only build geometry
and call `render_job`.

Conventions (see docs/BLENDER_SPRITE_PIPELINE.md):
  * 1 Blender unit = 1 game tile. Game tile +x = Blender +X,
    game tile +y = Blender -Y (the game grid is left-handed when seen from
    above, Blender is right-handed).
  * Orthographic camera, azimuth 45 deg, elevation 30 deg. A 1x1 ground
    square projects to a 2:1 diamond, 128x64 px at the 2x render scale.
  * The anchor of every sprite is the bottom (camera-nearest) corner of the
    footprint diamond, Blender point (+w/2, -h/2, 0) for a footprint
    centred on the origin. It always lands on an integer pixel corner.
  * Sun comes from the screen top-left, shadows fall to the bottom-right.
"""

from __future__ import annotations

import math
import os
import random
from dataclasses import dataclass, field
from typing import Callable, Iterable

import bpy
import numpy as np
from mathutils import Euler, Vector

# ---------------------------------------------------------------------------
# Projection constants
# ---------------------------------------------------------------------------

#: Art style of the whole pipeline. "A" = hi-res voxel diorama (default, 1x
#: render, everything voxelised, no anti-aliasing), "smooth" = the previous
#: anti-aliased 2x render. Switch with `configure()` before importing families.
STYLE = "A"
VOXEL = True
RENDER_SCALE = 1
TILE_W_PX = 64 * RENDER_SCALE
TILE_H_PX = 32 * RENDER_SCALE
#: Screen pixels per world unit along the camera's right and up axes.
PPU = TILE_W_PX / math.sqrt(2.0)

CAM_EULER = Euler((math.radians(60.0), 0.0, math.radians(45.0)), "XYZ")
_CAM_M = CAM_EULER.to_matrix()
SCREEN_RIGHT = (_CAM_M @ Vector((1.0, 0.0, 0.0))).normalized()
SCREEN_UP = (_CAM_M @ Vector((0.0, 1.0, 0.0))).normalized()
VIEW_DIR = (_CAM_M @ Vector((0.0, 0.0, -1.0))).normalized()

#: Unit vector pointing from the scene TOWARDS the sun. Horizontal part points
#: to the screen top-left (Blender -X, partly -Y), elevation 42 deg. The
#: left-front (-Y) walls are lit, the right-front (+X) walls are in shade and
#: shadows fall to the screen right, slightly down.
SUN_ELEVATION = math.radians(42.0)
_SUN_H = Vector((-1.0, -0.6, 0.0)).normalized()
SUN_DIR = Vector(
    (
        _SUN_H.x * math.cos(SUN_ELEVATION),
        _SUN_H.y * math.cos(SUN_ELEVATION),
        math.sin(SUN_ELEVATION),
    )
).normalized()
@dataclass(frozen=True)
class StyleConfig:
    """Render settings of one art style."""

    name: str
    voxel: bool
    render_scale: int
    samples: int
    shadow_samples: int
    denoise: bool
    filter_type: str
    filter_width: float
    sun_strength: float
    sun_color: tuple[float, float, float]
    sun_angle_deg: float
    sky_color: tuple[float, float, float]
    sky_strength: float
    frame_margin_px: int


STYLES: dict[str, StyleConfig] = {
    # Hi-res voxel diorama: 1 voxel = 2 px wide, 1 px per layer at 1x, soft
    # sun, GI occlusion, no pixel filter (every sample through the pixel
    # centre, so voxels stay crisp), no denoiser (it would smear voxels).
    "A": StyleConfig("A", True, 1, 192, 128, False, "GAUSSIAN", 0.01, 3.4, (1.0, 0.92, 0.78), 9.0,
                     (0.55, 0.66, 0.9), 0.75, 3),
    # Previous look: smooth anti-aliased 2x render, drawn at 0.5.
    "smooth": StyleConfig("smooth", False, 2, 96, 48, True, "BLACKMAN_HARRIS", 1.2, 3.0, (1.0, 0.93, 0.80), 3.5,
                          (0.50, 0.62, 0.85), 0.55, 6),
}

SUN_STRENGTH = STYLES["A"].sun_strength
SUN_COLOR = STYLES["A"].sun_color
SUN_ANGLE = math.radians(STYLES["A"].sun_angle_deg)
SKY_COLOR = STYLES["A"].sky_color
SKY_STRENGTH = STYLES["A"].sky_strength

FRAME_MARGIN_PX = STYLES["A"].frame_margin_px

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ART_DIR = os.path.join(REPO_ROOT, "art-source", "blender")
RAW_DIR = os.path.join(ART_DIR, "renders")
TMP_DIR = os.path.join(ART_DIR, ".tmp")


def configure(style: str) -> StyleConfig:
    """Select the art style. Call before importing the family modules, which
    read the projection constants (RENDER_SCALE, PPU...) at import time."""
    global STYLE, VOXEL, RENDER_SCALE, TILE_W_PX, TILE_H_PX, PPU
    global SUN_STRENGTH, SUN_COLOR, SUN_ANGLE, SKY_COLOR, SKY_STRENGTH, FRAME_MARGIN_PX
    if style not in STYLES:
        raise ValueError(f"unknown style {style!r}, pick one of {sorted(STYLES)}")
    cfg = STYLES[style]
    STYLE = cfg.name
    VOXEL = cfg.voxel
    RENDER_SCALE = cfg.render_scale
    TILE_W_PX = 64 * RENDER_SCALE
    TILE_H_PX = 32 * RENDER_SCALE
    PPU = TILE_W_PX / math.sqrt(2.0)
    SUN_STRENGTH = cfg.sun_strength
    SUN_COLOR = cfg.sun_color
    SUN_ANGLE = math.radians(cfg.sun_angle_deg)
    SKY_COLOR = cfg.sky_color
    SKY_STRENGTH = cfg.sky_strength
    FRAME_MARGIN_PX = cfg.frame_margin_px
    return cfg


def style_config() -> StyleConfig:
    return STYLES[STYLE]


def project_px(p: Vector, anchor_world: Vector) -> tuple[float, float]:
    """Project a world point to sprite pixel offsets relative to the anchor."""
    rel = p - anchor_world
    return rel.dot(SCREEN_RIGHT) * PPU, -rel.dot(SCREEN_UP) * PPU


def ground_shadow_point(p: Vector) -> Vector:
    """Where a point's shadow lands on the z=0 ground plane."""
    if p.z <= 0.0:
        return p.copy()
    t = p.z / SUN_DIR.z
    return Vector((p.x - SUN_DIR.x * t, p.y - SUN_DIR.y * t, 0.0))


# ---------------------------------------------------------------------------
# Scene setup
# ---------------------------------------------------------------------------


def _set_enum(owner, prop: str, value: str) -> bool:
    try:
        setattr(owner, prop, value)
        return True
    except (TypeError, AttributeError):
        return False


def configure_gpu() -> str:
    """Enable Metal/CUDA/OptiX GPU rendering when available."""
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except KeyError:
        return "CPU"
    for kind in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type != "CPU"]
        if gpus:
            for d in prefs.devices:
                d.use = d.type != "CPU"
            return kind
    return "CPU"


def new_scene(name: str, samples: int | None = None) -> bpy.types.Scene:
    """Create (or reset) a dedicated scene with camera, sun, sky and passes.

    Never touches other scenes, so it is safe to run inside a user's live
    Blender session through MCP. `samples` overrides the style's default.
    """
    cfg = style_config()
    samples = samples or cfg.samples
    old = bpy.data.scenes.get(name)
    if old is not None:
        for ob in list(old.collection.all_objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.scenes.remove(old)
    scene = bpy.data.scenes.new(name)
    if not _set_enum(scene.render, "engine", "CYCLES"):
        raise RuntimeError("Cycles is required for the sprite pipeline")
    device = configure_gpu()
    scene.cycles.device = "GPU" if device != "CPU" else "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = not cfg.voxel
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.use_denoising = cfg.denoise
    _set_enum(scene.cycles, "denoiser", "OPENIMAGEDENOISE")
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 2
    scene.cycles.transparent_max_bounces = 8
    scene.cycles.pixel_filter_type = cfg.filter_type
    scene.cycles.filter_width = cfg.filter_width
    scene.cycles.seed = 7
    scene.render.film_transparent = True
    scene.render.use_persistent_data = True
    scene.render.resolution_percentage = 100
    _set_enum(scene.view_settings, "view_transform", "Standard")
    _set_enum(scene.view_settings, "look", "None")
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    _set_enum(scene.display_settings, "display_device", "sRGB")

    ims = scene.render.image_settings
    _set_enum(ims, "media_type", "MULTI_LAYER_IMAGE")
    _set_enum(ims, "file_format", "OPEN_EXR_MULTILAYER")
    _set_enum(ims, "color_depth", "16")
    _set_enum(ims, "exr_codec", "ZIP")
    ims.color_mode = "RGBA"

    # World: soft sky fill. Film is transparent so it is never seen directly.
    world = bpy.data.worlds.new(name + "_world")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (*SKY_COLOR, 1.0)
    bg.inputs[1].default_value = SKY_STRENGTH
    scene.world = world

    # Camera.
    cam_data = bpy.data.cameras.new(name + "_cam")
    cam_data.type = "ORTHO"
    cam_data.clip_start = 0.1
    cam_data.clip_end = 400.0
    cam = bpy.data.objects.new(name + "_cam", cam_data)
    cam.rotation_euler = CAM_EULER
    scene.collection.objects.link(cam)
    scene.camera = cam

    # Sun.
    sun_data = bpy.data.lights.new(name + "_sun", "SUN")
    sun_data.energy = SUN_STRENGTH
    sun_data.color = SUN_COLOR
    sun_data.angle = SUN_ANGLE
    sun = bpy.data.objects.new(name + "_sun", sun_data)
    sun.rotation_euler = SUN_DIR.to_track_quat("Z", "Y").to_euler()
    scene.collection.objects.link(sun)

    # Ground: shadow catcher that also bounces warm earth light.
    me = bpy.data.meshes.new(name + "_ground")
    s = 60.0
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new(name + "_ground", me)
    ground.is_shadow_catcher = True
    ground.data.materials.append(make_flat_material("kr_ground_bounce", (0.30, 0.26, 0.18)))
    scene.collection.objects.link(ground)

    # View layers: "beauty" (colour + team AOV) and "shadow" (asset is
    # indirect-only so the catcher records the full contact shadow, also
    # under the footprint).
    beauty = scene.view_layers[0]
    beauty.name = "beauty"
    beauty.use_pass_combined = True
    beauty.cycles.use_pass_shadow_catcher = True
    aov = beauty.aovs.add()
    aov.name = "team"
    aov.type = "VALUE"
    shadow = scene.view_layers.new("shadow")
    shadow.use_pass_combined = True
    shadow.cycles.use_pass_shadow_catcher = True
    scene.cycles.use_layer_samples = "USE"
    shadow.samples = max(32, cfg.shadow_samples if samples == cfg.samples else samples // 2)
    scene["kr_ground"] = ground.name
    return scene


def asset_collection(scene: bpy.types.Scene, name: str) -> bpy.types.Collection:
    col = bpy.data.collections.new(name)
    scene.collection.children.link(col)
    return col


def _layer_col(view_layer: bpy.types.ViewLayer, col: bpy.types.Collection):
    def walk(lc):
        if lc.collection == col:
            return lc
        for ch in lc.children:
            r = walk(ch)
            if r is not None:
                return r
        return None

    if view_layer.layer_collection is None:  # layer tree not synced yet (new collections)
        view_layer.update()
    if view_layer.layer_collection is None:
        return None
    return walk(view_layer.layer_collection)


def solo_collection(scene: bpy.types.Scene, col: bpy.types.Collection | None) -> None:
    """Make only `col` renderable (plus the scene-level camera/sun/ground)."""
    for child in scene.collection.children:
        on = child == col
        child.hide_render = not on
        for vl in scene.view_layers:
            lc = _layer_col(vl, child)
            if lc is None:
                continue
            lc.exclude = not on
            if vl.name == "shadow":
                lc.indirect_only = True


# ---------------------------------------------------------------------------
# Framing
# ---------------------------------------------------------------------------


@dataclass
class Frame:
    """Pixel framing of one sprite (sizes at the 2x render scale)."""

    width: int
    height: int
    anchor_x: int
    anchor_y: int

    def union(self, other: "Frame") -> "Frame":
        left = max(self.anchor_x, other.anchor_x)
        right = max(self.width - self.anchor_x, other.width - other.anchor_x)
        top = max(self.anchor_y, other.anchor_y)
        bottom = max(self.height - self.anchor_y, other.height - other.anchor_y)
        return Frame(left + right, top + bottom, left, top)


def collection_points(col: bpy.types.Collection) -> np.ndarray:
    """World-space evaluated vertices of every renderable mesh in a collection (N, 3)."""
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()
    pts: list[np.ndarray] = []
    for ob in col.all_objects:
        if ob.type not in {"MESH", "CURVE", "SURFACE", "META", "FONT"}:
            continue
        if ob.hide_render:
            continue
        ev = ob.evaluated_get(deps)
        try:
            me = ev.to_mesh()
        except RuntimeError:
            continue
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get("co", co)
        mw = np.array(ev.matrix_world)
        pts.append(co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3])
        ev.to_mesh_clear()
    return np.concatenate(pts) if pts else np.zeros((0, 3))


def frame_from_points(
    pts: np.ndarray,
    footprint: tuple[float, float],
    include_shadow: bool = True,
    symmetric: bool = True,
    margin: int | None = None,
) -> tuple[Frame, Vector]:
    """Frame that contains the footprint diamond, the points and their shadow."""
    margin = FRAME_MARGIN_PX if margin is None else margin
    fw, fh = footprint
    anchor_world = Vector((fw / 2.0, -fh / 2.0, 0.0))
    corners = np.array([(-fw / 2, -fh / 2, 0), (fw / 2, -fh / 2, 0), (fw / 2, fh / 2, 0), (-fw / 2, fh / 2, 0)])
    all_pts = [corners, pts]
    if include_shadow and len(pts):
        z = np.maximum(pts[:, 2], 0.0)
        t = z / SUN_DIR.z
        sh = np.stack([pts[:, 0] - SUN_DIR.x * t, pts[:, 1] - SUN_DIR.y * t, np.zeros(len(pts))], axis=1)
        all_pts.append(sh)
    p = np.concatenate(all_pts) - np.array(anchor_world)
    xs = p @ np.array(SCREEN_RIGHT) * PPU
    ys = -(p @ np.array(SCREEN_UP)) * PPU
    left = math.ceil(max(0.0, -xs.min()) - 1e-6) + margin
    right = math.ceil(max(0.0, xs.max()) - 1e-6) + margin
    if symmetric:
        left = right = max(left, right)
    top = math.ceil(max(0.0, -ys.min()) - 1e-6) + margin
    bottom = math.ceil(max(0.0, ys.max()) - 1e-6) + margin
    return Frame(left + right, top + bottom, left, top), anchor_world


def compute_frame(
    col: bpy.types.Collection,
    footprint: tuple[float, float],
    include_shadow: bool = True,
    symmetric: bool = True,
    margin: int | None = None,
) -> tuple[Frame, Vector]:
    """Frame that contains the footprint diamond, the geometry and its shadow."""
    return frame_from_points(collection_points(col), footprint, include_shadow, symmetric, margin)


def place_camera(scene: bpy.types.Scene, frame: Frame, anchor_world: Vector) -> None:
    w, h = frame.width, frame.height
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.pixel_aspect_x = 1.0
    scene.render.pixel_aspect_y = 1.0
    cam = scene.camera
    cam.data.ortho_scale = max(w, h) / PPU
    cam.data.sensor_fit = "AUTO"
    cam.data.shift_x = 0.0
    cam.data.shift_y = 0.0
    ox = (frame.anchor_x - w / 2.0) / PPU
    oy = (h / 2.0 - frame.anchor_y) / PPU
    centre = anchor_world - SCREEN_RIGHT * ox - SCREEN_UP * oy
    cam.location = centre - VIEW_DIR * 150.0


# ---------------------------------------------------------------------------
# Rendering and pass extraction
# ---------------------------------------------------------------------------


def _srgb_encode(lin: np.ndarray) -> np.ndarray:
    lin = np.clip(lin, 0.0, 1.0)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1.0 / 2.4) - 0.055)


def _read_exr_layers(path: str) -> dict[str, np.ndarray]:
    import OpenImageIO as oiio

    inp = oiio.ImageInput.open(path)
    if inp is None:
        raise RuntimeError(f"cannot open {path}: {oiio.geterror()}")
    out: dict[str, np.ndarray] = {}
    sub = 0
    # Blender writes multi-part EXRs: one part (OIIO subimage) per layer/pass.
    while inp.seek_subimage(sub, 0):
        spec = inp.spec()
        data = inp.read_image(sub, 0, 0, spec.nchannels, "float")
        data = np.asarray(data).reshape(spec.height, spec.width, spec.nchannels)
        for i, name in enumerate(spec.channelnames):
            out[name] = data[:, :, i]
        sub += 1
    inp.close()
    return out


def _find(ch: dict[str, np.ndarray], layer: str, pass_name: str, comps: str) -> np.ndarray | None:
    out = []
    for c in comps:
        key = f"{layer}.{pass_name}.{c}"
        if key not in ch:
            return None
        out.append(ch[key])
    return np.stack(out, axis=-1)


def write_png(path: str, rgba8: np.ndarray) -> None:
    """Write an HxWx4 uint8 array as PNG (OpenImageIO inside Blender)."""
    import OpenImageIO as oiio

    os.makedirs(os.path.dirname(path), exist_ok=True)
    h, w, c = rgba8.shape
    spec = oiio.ImageSpec(w, h, c, "uint8")
    spec.attribute("png:compressionLevel", 9)
    out = oiio.ImageOutput.create(path)
    if out is None or not out.open(path, spec):
        raise RuntimeError(f"cannot write {path}: {oiio.geterror()}")
    out.write_image(np.ascontiguousarray(rgba8))
    out.close()


@dataclass
class RenderResult:
    beauty: np.ndarray  # HxWx4 uint8, straight alpha, sRGB
    mask: np.ndarray | None  # HxWx4 uint8, white with alpha = team coverage
    shadow: np.ndarray | None  # HxWx4 uint8, black with alpha = shadow
    frame: Frame


def render_collection(
    scene: bpy.types.Scene,
    col: bpy.types.Collection,
    frame: Frame,
    anchor_world: Vector,
    want_shadow: bool = True,
    shadow_strength: float = 0.62,
) -> RenderResult:
    solo_collection(scene, col)
    place_camera(scene, frame, anchor_world)
    shadow_vl = scene.view_layers.get("shadow")
    if shadow_vl is not None:
        shadow_vl.use = want_shadow
    os.makedirs(TMP_DIR, exist_ok=True)
    exr = os.path.join(TMP_DIR, f"{scene.name}_{col.name}.exr")
    scene.render.filepath = exr
    if bpy.context.window is not None:
        bpy.ops.render.render(write_still=True, scene=scene.name)
    else:
        with bpy.context.temp_override(scene=scene):
            bpy.ops.render.render(write_still=True, scene=scene.name)
    ch = _read_exr_layers(exr)
    if os.environ.get("KR_DEBUG"):
        print("EXR channels", sorted(ch))
    else:
        try:
            os.remove(exr)
        except OSError:
            pass

    comb = _find(ch, "beauty", "Combined", "RGBA")
    if comb is None:
        raise RuntimeError(f"no beauty pass in {sorted(ch)[:12]}")
    voxel = style_config().voxel
    alpha = np.clip(comb[..., 3], 0.0, 1.0)
    rgb = comb[..., :3]
    safe = np.where(alpha > 1e-4, alpha, 1.0)[..., None]
    straight = np.where(alpha[..., None] > 1e-4, rgb / safe, 0.0)
    srgb = _srgb_encode(straight)
    if voxel:
        # style A: graded at render time, hard (binary) alpha, no fringe
        srgb = grade_a(srgb)
        alpha = np.where(alpha > 0.5, 1.0, 0.0)
    beauty = np.zeros(comb.shape, dtype=np.uint8)
    beauty[..., :3] = np.round(srgb * 255.0).astype(np.uint8)
    beauty[..., 3] = np.round(alpha * 255.0).astype(np.uint8)
    beauty[alpha < 1.0 / 255.0] = 0

    mask = None
    team = None
    for key in ("beauty.team.V", "beauty.team.X", "beauty.team.R", "beauty.team.A"):
        if key in ch:
            team = ch[key]
            break
    if team is not None and float(team.max()) > 0.01:
        m = np.clip(team, 0.0, 1.0)
        if voxel:
            m = np.where((m > 0.5) & (alpha > 0.5), 1.0, 0.0)
        mask = np.zeros(comb.shape, dtype=np.uint8)
        mask[..., :3] = 255
        mask[..., 3] = np.round(m * 255.0).astype(np.uint8)
        if not mask[..., 3].any():
            mask = None

    shadow = None
    if want_shadow:
        sc = _find(ch, "shadow", "Shadow Catcher", "RGB")
        if sc is not None:
            occl = 1.0 - np.clip(sc.mean(axis=-1), 0.0, 1.0)
            if voxel:
                occl = _box_blur3(occl)  # no-AA catcher is grainy
            a = np.clip(occl, 0.0, 1.0) * shadow_strength
            shadow = np.zeros(comb.shape, dtype=np.uint8)
            shadow[..., :3] = (18, 14, 8)
            shadow[..., 3] = np.round(np.clip(a, 0, 1) * 255.0).astype(np.uint8)
            shadow[shadow[..., 3] < 2] = 0
    return RenderResult(beauty, mask, shadow, frame)


def _box_blur3(a: np.ndarray) -> np.ndarray:
    p = np.pad(a, 1, mode="edge")
    out = np.zeros_like(a)
    for dy in range(3):
        for dx in range(3):
            out += p[dy: dy + a.shape[0], dx: dx + a.shape[1]]
    return out / 9.0


def grade_a(srgb: np.ndarray, sat: float = 1.06, contrast: float = 1.04, warm: float = 0.4,
            cool_shadows: float = 0.5) -> np.ndarray:
    """Style A colour grade (sRGB 0..1 in and out), same as style-explore."""
    w = np.array([0.2126, 0.7152, 0.0722])
    x = srgb.copy()
    lum = (x @ w)[..., None]
    x = lum + (x - lum) * sat
    x = (x - 0.5) * contrast + 0.5
    lum = (np.clip(x, 0, 1) @ w)[..., None]
    x = x + warm * lum * np.array([1.0, 0.45, -0.6]) * 0.1
    x = x + cool_shadows * (1 - lum) ** 2 * np.array([-0.4, -0.1, 0.8]) * 0.1
    return np.clip(x, 0, 1)


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------


@dataclass
class Job:
    """One sprite to render.

    `group` jobs share one union frame so variants of the same logical asset
    (eras, construction stages) have identical size and anchor.
    """

    name: str
    build: Callable[[bpy.types.Collection, random.Random], None]
    footprint: tuple[float, float] = (1.0, 1.0)
    group: str = ""
    shadow: bool = True
    shadow_strength: float = 0.62
    symmetric: bool = True
    meta: dict = field(default_factory=dict)
    #: extra voxel poses rendered as `<name>__<pose>` frames (style A only),
    #: see kr_voxel.POSES (e.g. "swayl", "swayr" for trees)
    poses: tuple[str, ...] = ()


def _write_record(rec: dict, base: str, res: RenderResult) -> None:
    write_png(base + ".png", res.beauty)
    rec["files"]["frame"] = base + ".png"
    if res.mask is not None:
        write_png(base + "__mask.png", res.mask)
        rec["files"]["mask"] = base + "__mask.png"
    if res.shadow is not None:
        write_png(base + "__shadow.png", res.shadow)
        rec["files"]["shadow"] = base + "__shadow.png"


def run_jobs(
    scene: bpy.types.Scene,
    jobs: Iterable[Job],
    out_dir: str,
    seed: int = 1,
    log: Callable[[str], None] = print,
) -> list[dict]:
    """Build every job into its own collection, frame per group, render, save PNGs.

    Style A voxelises each collection right after it is built (the voxel
    grid, not the mesh, is what gets framed and rendered). Returns a list of
    records (frame name, files, size, anchor, meta) that the packer turns
    into atlases and the manifest.
    """
    import kr_voxel

    jobs = list(jobs)
    built: list[tuple[Job, bpy.types.Collection, Frame, Vector, dict | None]] = []
    for job in jobs:
        col = asset_collection(scene, job.name)
        rng = random.Random(f"{seed}:{job.name}")
        job.build(col, rng)
        finalize_collection(col)
        vox = None
        if VOXEL:
            vox = kr_voxel.voxelize_collection(scene, col, job.poses, seed)
            pts = kr_voxel.corner_points(vox)
            log(f"voxelised {job.name}: {len(vox[''].ijk)} voxels")
        else:
            pts = collection_points(col)
        frame, anchor_world = frame_from_points(pts, job.footprint, job.shadow, job.symmetric)
        built.append((job, col, frame, anchor_world, vox))
    group_frames: dict[str, Frame] = {}
    for job, _col, frame, _a, _v in built:
        key = job.group or job.name
        group_frames[key] = group_frames[key].union(frame) if key in group_frames else frame
    records = []
    for job, col, _frame, anchor_world, vox in built:
        frame = group_frames[job.group or job.name]
        poses = [""]
        objs: dict = {}
        if vox is not None:
            objs = kr_voxel.build_pose_objects(vox, col, job.name)
            poses += [p for p in objs if p]
        for pose in poses:
            hold = None
            if objs:
                kr_voxel.show_pose(objs, pose)
                if kr_voxel.is_overlay(pose):
                    hold = kr_voxel.build_holdout(vox[""], vox[pose], col, job.name)
            want_shadow = job.shadow and not pose
            res = render_collection(scene, col, frame, anchor_world, want_shadow, job.shadow_strength)
            if hold is not None:
                me = hold.data
                bpy.data.objects.remove(hold, do_unlink=True)
                bpy.data.meshes.remove(me)
            name = job.name + (f"__{pose}" if pose else "")
            rec = {
                "name": name,
                "width": frame.width,
                "height": frame.height,
                "anchor": [frame.anchor_x, frame.anchor_y],
                "footprint": list(job.footprint),
                "meta": dict(job.meta, pose=pose, of=job.name, overlay=kr_voxel.is_overlay(pose)) if pose else job.meta,
                "files": {},
            }
            _write_record(rec, os.path.join(out_dir, name), res)
            records.append(rec)
            log(f"rendered {name} {frame.width}x{frame.height} anchor {frame.anchor_x},{frame.anchor_y}")
        if vox is not None:
            kr_voxel.restore_collection(col)
    return records


def finalize_collection(col: bpy.types.Collection) -> None:
    """Give every mesh world-scaled planar UVs (unless flagged) and smooth tidy-ups."""
    for ob in col.all_objects:
        if ob.type != "MESH":
            continue
        if not ob.get("kr_keep_uv"):
            world_planar_uv(ob)


def world_planar_uv(ob: bpy.types.Object) -> None:
    """Per-face planar UVs in world units: u runs horizontally along the face,
    v runs up the face (or along +Y for horizontal faces). Brick, tile and
    plank textures therefore line up on walls and roof slopes alike."""
    me = ob.data
    if not me.polygons:
        return
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    up = Vector((0.0, 0.0, 1.0))
    for poly in me.polygons:
        n = (nm @ poly.normal).normalized()
        if abs(n.z) > 0.985:
            t = Vector((1.0, 0.0, 0.0))
            b = Vector((0.0, 1.0, 0.0))
        else:
            t = up.cross(n)
            t.normalize()
            b = n.cross(t)
            b.normalize()
        for li in poly.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (co.dot(t), co.dot(b))


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

_MAT_CACHE: dict[str, bpy.types.Material] = {}


class NodeBuilder:
    """Tiny helper to keep material node graphs readable."""

    def __init__(self, mat: bpy.types.Material):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = 0

    def n(self, kind: str, **props):
        node = self.nt.nodes.new(kind)
        node.location = (self.x, 0)
        self.x += 180
        for k, v in props.items():
            if k.startswith("in_"):
                key = k[3:]
                idx = int(key) if key.isdigit() else key.replace("_", " ")
                node.inputs[idx].default_value = v
            else:
                setattr(node, k, v)
        return node

    def link(self, out_sock, in_sock) -> None:
        self.nt.links.new(out_sock, in_sock)


def _inp(node, *names):
    for name in names:
        if name in node.inputs:
            return node.inputs[name]
    raise KeyError(f"{node.bl_idname} has none of {names}")


def _out(node, *names):
    for name in names:
        if name in node.outputs:
            return node.outputs[name]
    raise KeyError(f"{node.bl_idname} has none of {names}")


def hex_rgb(h: int) -> tuple[float, float, float]:
    """0xRRGGBB (sRGB) to linear RGB."""
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (lin(((h >> 16) & 255) / 255.0), lin(((h >> 8) & 255) / 255.0), lin((h & 255) / 255.0))


def make_flat_material(name: str, rgb_lin: tuple[float, float, float], roughness: float = 0.9) -> bpy.types.Material:
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    bsdf = nb.n("ShaderNodeBsdfPrincipled")
    _inp(bsdf, "Base Color").default_value = (*rgb_lin, 1.0)
    _inp(bsdf, "Roughness").default_value = roughness
    out = nb.n("ShaderNodeOutputMaterial")
    nb.link(bsdf.outputs[0], out.inputs["Surface"])
    return mat


@dataclass(frozen=True)
class Surface:
    """Recipe for a procedural surface material.

    colors: 2-3 sRGB hex colours mixed by low-frequency noise.
    pattern: none | brick | planks | tiles | thatch | shingles | rock | bark |
             leaves | soil | straw | metal | cloth | glow
    scale: pattern size in world units (brick height, plank width...).
    """

    colors: tuple[int, ...]
    pattern: str = "none"
    scale: float = 0.1
    mortar: int = 0x000000
    roughness: float = 0.85
    bump: float = 0.25
    noise_scale: float = 6.0
    grime: float = 0.25
    team: bool = False
    metallic: float = 0.0
    emission: float = 0.0
    ao: float = 0.55
    coords: str = "uv"  # uv | object | generated


#: Blender material name -> Surface recipe. The style A voxeliser colours
#: voxels from these recipes instead of the shader graph.
SURFACES: dict[str, Surface] = {}


def material(name: str, s: Surface) -> bpy.types.Material:
    if name in _MAT_CACHE and _MAT_CACHE[name].name in bpy.data.materials:
        return _MAT_CACHE[name]
    mat = bpy.data.materials.new("kr_" + name)
    _build_surface(mat, s)
    _MAT_CACHE[name] = mat
    SURFACES[mat.name] = s
    return mat


def _build_surface(mat: bpy.types.Material, s: Surface) -> None:
    nb = NodeBuilder(mat)
    tc = nb.n("ShaderNodeTexCoord")
    if s.coords == "uv":
        vec = tc.outputs["UV"]
    elif s.coords == "generated":
        vec = tc.outputs["Generated"]
    else:
        vec = tc.outputs["Object"]
    geo = nb.n("ShaderNodeNewGeometry")
    cols = [hex_rgb(c) for c in s.colors] or [(0.5, 0.5, 0.5)]
    while len(cols) < 3:
        cols.append(cols[-1])

    # Low frequency colour drift.
    noise = nb.n("ShaderNodeTexNoise", in_Scale=s.noise_scale, in_Detail=4.0, in_Roughness=0.6)
    nb.link(vec if s.coords != "uv" else tc.outputs["Object"], noise.inputs["Vector"])
    ramp = nb.n("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].position = 0.3
    cr.elements[0].color = (*cols[0], 1)
    cr.elements[1].position = 0.7
    cr.elements[1].color = (*cols[1], 1)
    mid = cr.elements.new(0.5)
    mid.color = tuple((a + b) / 2 for a, b in zip(cols[0], cols[1])) + (1,)
    nb.link(noise.outputs["Fac"], ramp.inputs["Fac"])
    base = ramp.outputs["Color"]
    height = None

    pat = s.pattern
    if pat in {"brick", "tiles", "planks", "shingles"}:
        mapping = nb.n("ShaderNodeMapping")
        nb.link(vec, mapping.inputs["Vector"])
        if pat == "planks":
            # vertical boards: swap u/v so "bricks" run up the wall
            mapping.inputs["Rotation"].default_value = (0, 0, math.radians(90))
        brick = nb.n("ShaderNodeTexBrick")
        if pat == "brick":
            brick.inputs["Scale"].default_value = 1.0 / (s.scale * 2.0)
            brick.inputs["Mortar Size"].default_value = 0.035
            brick.inputs["Brick Width"].default_value = 1.0
            brick.inputs["Row Height"].default_value = 0.5
            brick.offset = 0.5
        elif pat == "tiles":
            brick.inputs["Scale"].default_value = 1.0 / (s.scale * 2.0)
            brick.inputs["Mortar Size"].default_value = 0.06
            brick.inputs["Brick Width"].default_value = 0.6
            brick.inputs["Row Height"].default_value = 0.5
            brick.offset = 0.5
        elif pat == "shingles":
            brick.inputs["Scale"].default_value = 1.0 / (s.scale * 2.0)
            brick.inputs["Mortar Size"].default_value = 0.05
            brick.inputs["Brick Width"].default_value = 0.7
            brick.inputs["Row Height"].default_value = 0.42
            brick.offset = 0.5
        else:  # planks
            brick.inputs["Scale"].default_value = 1.0 / (s.scale * 2.0)
            brick.inputs["Mortar Size"].default_value = 0.03
            brick.inputs["Brick Width"].default_value = 6.0
            brick.inputs["Row Height"].default_value = 0.5
            brick.offset = 0.37
        brick.inputs["Mortar Smooth"].default_value = 0.15
        brick.inputs["Bias"].default_value = 0.0
        nb.link(mapping.outputs["Vector"], brick.inputs["Vector"])
        # per-brick colour: random factor mixes the colour drift with colour 3
        c1 = nb.n("ShaderNodeMix", data_type="RGBA", blend_type="MIX")
        nb.link(brick.outputs["Fac"], c1.inputs["Factor"])
        nb.link(base, c1.inputs[6])
        c1.inputs[7].default_value = (*cols[2], 1)
        mort = nb.n("ShaderNodeMix", data_type="RGBA", blend_type="MIX")
        nb.link(c1.outputs[2], mort.inputs[6])
        mort.inputs[7].default_value = (*hex_rgb(s.mortar), 1)
        # Brick "Fac" output is the per-brick random value; mortar mask is
        # derived from Color output with color1=white, mortar=black.
        brick.inputs["Color1"].default_value = (1, 1, 1, 1)
        brick.inputs["Color2"].default_value = (1, 1, 1, 1)
        brick.inputs["Mortar"].default_value = (0, 0, 0, 1)
        inv = nb.n("ShaderNodeInvert")
        nb.link(brick.outputs["Color"], inv.inputs["Color"])
        bw = nb.n("ShaderNodeRGBToBW")
        nb.link(inv.outputs["Color"], bw.inputs["Color"])
        nb.link(bw.outputs["Val"], mort.inputs["Factor"])
        base = mort.outputs[2]
        height = brick.outputs["Color"]
    elif pat in {"thatch", "straw"}:
        mapping = nb.n("ShaderNodeMapping")
        nb.link(vec, mapping.inputs["Vector"])
        mapping.inputs["Scale"].default_value = (1.0, 0.18, 1.0)
        streak = nb.n("ShaderNodeTexNoise", in_Scale=1.0 / max(s.scale, 1e-3), in_Detail=6.0, in_Roughness=0.7)
        nb.link(mapping.outputs["Vector"], streak.inputs["Vector"])
        mix = nb.n("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        mix.inputs["Factor"].default_value = 0.65
        nb.link(base, mix.inputs[6])
        sramp = nb.n("ShaderNodeValToRGB")
        sramp.color_ramp.elements[0].position = 0.35
        sramp.color_ramp.elements[0].color = (0.55, 0.5, 0.45, 1)
        sramp.color_ramp.elements[1].position = 0.65
        sramp.color_ramp.elements[1].color = (1.15, 1.08, 1.0, 1)
        nb.link(streak.outputs["Fac"], sramp.inputs["Fac"])
        nb.link(sramp.outputs["Color"], mix.inputs[7])
        base = mix.outputs[2]
        height = streak.outputs["Fac"]
        if pat == "thatch":
            # horizontal courses of thatch bundles
            wave = nb.n("ShaderNodeTexWave", wave_type="BANDS", bands_direction="Y")
            wave.inputs["Scale"].default_value = 1.0 / (s.scale * 18.0)
            wave.inputs["Distortion"].default_value = 3.0
            wave.inputs["Detail"].default_value = 2.0
            nb.link(vec, wave.inputs["Vector"])
            add = nb.n("ShaderNodeMath", operation="MULTIPLY_ADD")
            nb.link(wave.outputs["Fac"], add.inputs[0])
            add.inputs[1].default_value = 0.35
            nb.link(streak.outputs["Fac"], add.inputs[2])
            height = add.outputs[0]
    elif pat in {"rock", "soil", "bark", "leaves", "metal", "cloth", "glow", "none"}:
        tex = None
        if pat == "rock":
            tex = nb.n("ShaderNodeTexVoronoi", in_Scale=1.0 / max(s.scale, 1e-3))
            nb.link(tc.outputs["Object"], tex.inputs["Vector"])
            height = _out(tex, "Distance")
            dark = nb.n("ShaderNodeMix", data_type="RGBA", blend_type="MIX")
            nb.link(base, dark.inputs[6])
            dark.inputs[7].default_value = (*cols[2], 1)
            fac = nb.n("ShaderNodeMath", operation="POWER")
            nb.link(_out(tex, "Distance"), fac.inputs[0])
            fac.inputs[1].default_value = 0.6
            inv = nb.n("ShaderNodeMath", operation="SUBTRACT")
            inv.inputs[0].default_value = 1.0
            nb.link(fac.outputs[0], inv.inputs[1])
            nb.link(inv.outputs[0], dark.inputs["Factor"])
            base = dark.outputs[2]
        elif pat in {"bark", "soil", "leaves", "cloth"}:
            tex = nb.n("ShaderNodeTexNoise", in_Scale=1.0 / max(s.scale, 1e-3), in_Detail=8.0, in_Roughness=0.65)
            nb.link(vec if s.coords != "uv" else vec, tex.inputs["Vector"])
            height = tex.outputs["Fac"]
            if pat in {"leaves", "soil", "bark"}:
                vor = nb.n("ShaderNodeTexVoronoi", in_Scale=1.0 / max(s.scale, 1e-3) * 1.7)
                nb.link(tc.outputs["Object"], vor.inputs["Vector"])
                cmix = nb.n("ShaderNodeMix", data_type="RGBA", blend_type="MIX")
                nb.link(_out(vor, "Distance"), cmix.inputs["Factor"])
                nb.link(base, cmix.inputs[7])
                cmix.inputs[6].default_value = (*cols[2], 1)
                base = cmix.outputs[2]
                h2 = nb.n("ShaderNodeMath", operation="ADD")
                nb.link(tex.outputs["Fac"], h2.inputs[0])
                nb.link(_out(vor, "Distance"), h2.inputs[1])
                height = h2.outputs[0]

    # Grime: darken towards the ground (world z).
    if s.grime > 0:
        sep = nb.n("ShaderNodeSeparateXYZ")
        nb.link(geo.outputs["Position"], sep.inputs[0])
        gz = nb.n("ShaderNodeMapRange")
        nb.link(sep.outputs["Z"], gz.inputs["Value"])
        gz.inputs["From Min"].default_value = 0.0
        gz.inputs["From Max"].default_value = 0.35
        gz.inputs["To Min"].default_value = 1.0 - s.grime
        gz.inputs["To Max"].default_value = 1.0
        gm = nb.n("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        gm.inputs["Factor"].default_value = 1.0
        nb.link(base, gm.inputs[6])
        comb = nb.n("ShaderNodeCombineXYZ")
        for i in range(3):
            nb.link(gz.outputs["Result"], comb.inputs[i])
        nb.link(comb.outputs[0], gm.inputs[7])
        base = gm.outputs[2]

    # Cavity / contact darkening via the AO node.
    if s.ao > 0:
        ao = nb.n("ShaderNodeAmbientOcclusion", samples=8)
        ao.inputs["Distance"].default_value = 0.25
        aom = nb.n("ShaderNodeMapRange")
        nb.link(_out(ao, "AO"), aom.inputs["Value"])
        aom.inputs["To Min"].default_value = 1.0 - s.ao
        aom.inputs["To Max"].default_value = 1.0
        am = nb.n("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        am.inputs["Factor"].default_value = 1.0
        nb.link(base, am.inputs[6])
        comb = nb.n("ShaderNodeCombineXYZ")
        for i in range(3):
            nb.link(aom.outputs["Result"], comb.inputs[i])
        nb.link(comb.outputs[0], am.inputs[7])
        base = am.outputs[2]

    bsdf = nb.n("ShaderNodeBsdfPrincipled")
    nb.link(base, _inp(bsdf, "Base Color"))
    _inp(bsdf, "Roughness").default_value = s.roughness
    _inp(bsdf, "Metallic").default_value = s.metallic
    try:
        _inp(bsdf, "Specular IOR Level", "Specular").default_value = 0.25 if s.metallic < 0.5 else 0.5
    except KeyError:
        pass
    if height is not None and s.bump > 0:
        bump = nb.n("ShaderNodeBump")
        bump.inputs["Strength"].default_value = s.bump
        bump.inputs["Distance"].default_value = 0.02
        nb.link(height, bump.inputs["Height"])
        nb.link(bump.outputs["Normal"], _inp(bsdf, "Normal"))
    if s.emission > 0:
        nb.link(base, _inp(bsdf, "Emission Color", "Emission"))
        _inp(bsdf, "Emission Strength").default_value = s.emission
    out = nb.n("ShaderNodeOutputMaterial")
    nb.link(bsdf.outputs[0], out.inputs["Surface"])
    if s.team:
        aov = nb.n("ShaderNodeOutputAOV")
        aov.aov_name = "team"
        _inp(aov, "Value").default_value = 1.0
