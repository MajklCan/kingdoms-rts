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

RENDER_SCALE = 2
TILE_W_PX = 64 * RENDER_SCALE
TILE_H_PX = 32 * RENDER_SCALE
#: Screen pixels per world unit along the camera's right and up axes (2x).
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
SUN_STRENGTH = 3.0
SUN_COLOR = (1.0, 0.93, 0.80)
SUN_ANGLE = math.radians(3.5)
SKY_COLOR = (0.50, 0.62, 0.85)
SKY_STRENGTH = 0.55

FRAME_MARGIN_PX = 6

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ART_DIR = os.path.join(REPO_ROOT, "art-source", "blender")
RAW_DIR = os.path.join(ART_DIR, "renders")
TMP_DIR = os.path.join(ART_DIR, ".tmp")


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


def new_scene(name: str, samples: int = 96) -> bpy.types.Scene:
    """Create (or reset) a dedicated scene with camera, sun, sky and passes.

    Never touches other scenes, so it is safe to run inside a user's live
    Blender session through MCP.
    """
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
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.use_denoising = True
    _set_enum(scene.cycles, "denoiser", "OPENIMAGEDENOISE")
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 2
    scene.cycles.transparent_max_bounces = 8
    scene.cycles.pixel_filter_type = "BLACKMAN_HARRIS"
    scene.cycles.filter_width = 1.2
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
    shadow.samples = max(32, samples // 2)
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


def collection_points(col: bpy.types.Collection) -> list[Vector]:
    """World-space evaluated vertices of every mesh in a collection."""
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()
    pts: list[Vector] = []
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
        mw = ev.matrix_world
        pts.extend(mw @ v.co for v in me.vertices)
        ev.to_mesh_clear()
    return pts


def compute_frame(
    col: bpy.types.Collection,
    footprint: tuple[float, float],
    include_shadow: bool = True,
    symmetric: bool = True,
    margin: int = FRAME_MARGIN_PX,
) -> tuple[Frame, Vector]:
    """Frame that contains the footprint diamond, the geometry and its shadow."""
    fw, fh = footprint
    anchor_world = Vector((fw / 2.0, -fh / 2.0, 0.0))
    pts = collection_points(col)
    corners = [
        Vector((-fw / 2, -fh / 2, 0)),
        Vector((fw / 2, -fh / 2, 0)),
        Vector((fw / 2, fh / 2, 0)),
        Vector((-fw / 2, fh / 2, 0)),
    ]
    all_pts = list(corners) + pts
    if include_shadow:
        all_pts += [ground_shadow_point(p) for p in pts]
    xs, ys = [], []
    for p in all_pts:
        x, y = project_px(p, anchor_world)
        xs.append(x)
        ys.append(y)
    left = math.ceil(max(0.0, -min(xs))) + margin
    right = math.ceil(max(0.0, max(xs))) + margin
    if symmetric:
        left = right = max(left, right)
    top = math.ceil(max(0.0, -min(ys))) + margin
    bottom = math.ceil(max(0.0, max(ys))) + margin
    return Frame(left + right, top + bottom, left, top), anchor_world


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
    alpha = np.clip(comb[..., 3], 0.0, 1.0)
    rgb = comb[..., :3]
    safe = np.where(alpha > 1e-4, alpha, 1.0)[..., None]
    straight = np.where(alpha[..., None] > 1e-4, rgb / safe, 0.0)
    beauty = np.zeros(comb.shape, dtype=np.uint8)
    beauty[..., :3] = np.round(_srgb_encode(straight) * 255.0).astype(np.uint8)
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
        mask = np.zeros(comb.shape, dtype=np.uint8)
        mask[..., :3] = 255
        mask[..., 3] = np.round(m * 255.0).astype(np.uint8)

    shadow = None
    if want_shadow:
        sc = _find(ch, "shadow", "Shadow Catcher", "RGB")
        if sc is not None:
            occl = 1.0 - np.clip(sc.mean(axis=-1), 0.0, 1.0)
            a = np.clip(occl, 0.0, 1.0) * shadow_strength
            shadow = np.zeros(comb.shape, dtype=np.uint8)
            shadow[..., :3] = (18, 14, 8)
            shadow[..., 3] = np.round(np.clip(a, 0, 1) * 255.0).astype(np.uint8)
            shadow[shadow[..., 3] < 2] = 0
    return RenderResult(beauty, mask, shadow, frame)


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


def run_jobs(
    scene: bpy.types.Scene,
    jobs: Iterable[Job],
    out_dir: str,
    seed: int = 1,
    log: Callable[[str], None] = print,
) -> list[dict]:
    """Build every job into its own collection, frame per group, render, save PNGs.

    Returns a list of records (frame name, files, size, anchor, meta) that the
    packer turns into atlases and the manifest.
    """
    jobs = list(jobs)
    built: list[tuple[Job, bpy.types.Collection, Frame, Vector]] = []
    for i, job in enumerate(jobs):
        col = asset_collection(scene, job.name)
        rng = random.Random(f"{seed}:{job.name}")
        job.build(col, rng)
        finalize_collection(col)
        frame, anchor_world = compute_frame(col, job.footprint, job.shadow, job.symmetric)
        built.append((job, col, frame, anchor_world))
    group_frames: dict[str, Frame] = {}
    for job, _col, frame, _a in built:
        key = job.group or job.name
        group_frames[key] = group_frames[key].union(frame) if key in group_frames else frame
    records = []
    for job, col, _frame, anchor_world in built:
        frame = group_frames[job.group or job.name]
        res = render_collection(scene, col, frame, anchor_world, job.shadow, job.shadow_strength)
        rec = {
            "name": job.name,
            "width": frame.width,
            "height": frame.height,
            "anchor": [frame.anchor_x, frame.anchor_y],
            "footprint": list(job.footprint),
            "meta": job.meta,
            "files": {},
        }
        base = os.path.join(out_dir, job.name)
        write_png(base + ".png", res.beauty)
        rec["files"]["frame"] = base + ".png"
        if res.mask is not None:
            write_png(base + "__mask.png", res.mask)
            rec["files"]["mask"] = base + "__mask.png"
        if res.shadow is not None:
            write_png(base + "__shadow.png", res.shadow)
            rec["files"]["shadow"] = base + "__shadow.png"
        records.append(rec)
        log(f"rendered {job.name} {frame.width}x{frame.height} anchor {frame.anchor_x},{frame.anchor_y}")
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


def material(name: str, s: Surface) -> bpy.types.Material:
    if name in _MAT_CACHE and _MAT_CACHE[name].name in bpy.data.materials:
        return _MAT_CACHE[name]
    mat = bpy.data.materials.new("kr_" + name)
    _build_surface(mat, s)
    _MAT_CACHE[name] = mat
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
