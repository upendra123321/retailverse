"""One-time offline tool: parse convenience_store.glb and derive a store layout
catalog (every product instance + its 3D position + an auto-clustered shelf/zone
id) so the app can attribute gaze/attention to "which product / which shelf /
which aisle" instead of only a generic screen-space grid.

This does NOT touch how the 3D model is generated/rendered (per the challenge
notes: "ignore how to generate 3d view of the store") - it only *reads* the
existing GLB's node names + transforms to build metadata used for analytics.

Run once (or whenever the GLB changes):

    python scripts/extract_store_layout.py

Output: backend/data/store_layout.json
"""
from __future__ import annotations

import json
import re
import struct
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = REPO_ROOT / "convenience_store.glb"
OUTPUT_PATH = REPO_ROOT / "backend" / "data" / "store_layout.json"

# Nodes that are structural/camera wrappers, never real products.
IGNORE_NAME_PATTERNS = [
    r"^Sketchfab_model$",
    r"^RootNode$",
    r"^Camera$",
    r"^Object_\d+$",
    r"\.fbx$",
]

# Trailing ".017" / ".2" style Blender/Sketchfab duplicate-instance suffixes.
TRAILING_INDEX_RE = re.compile(r"\.\d+$")

# Manual curation for THIS specific model: raw glTF node "product_key" values ->
# a friendly catalog display name, a zone type, and an optional "merge_as" id so
# closely related fixtures (e.g. the 3 checkout registers) collapse into one
# analytics zone. Anything not listed here defaults to type="product" and keeps
# its own raw key as both id and display name - update this map after eyeballing
# a fresh backend/data/store_layout.json whenever the GLB changes.
PRODUCT_CATALOG: dict[str, dict] = {
    "Oatmeal": {"display_name": "Oatmeal (Value Pack)", "type": "product", "category": "breakfast"},
    "Oatmeal_#1": {"display_name": "Oatmeal (Family Pack)", "type": "product", "category": "breakfast"},
    "trix": {"display_name": "Trix Cereal", "type": "product", "category": "breakfast"},
    "luckycharm": {"display_name": "Lucky Charms Cereal", "type": "product", "category": "breakfast"},
    "luckycharm_1": {"display_name": "Lucky Charms Cereal (Family Size)", "type": "product", "category": "breakfast"},
    "rice crisps": {"display_name": "Rice Crispies Cereal", "type": "product", "category": "breakfast"},
    "crispix": {"display_name": "Crispix Cereal", "type": "product", "category": "breakfast"},
    "cerial meal": {"display_name": "Cereal Meal", "type": "product", "category": "breakfast"},
    "Tuna can": {"display_name": "Tuna Can (Small)", "type": "product", "category": "canned_goods"},
    "tuna can large": {"display_name": "Tuna Can (Large)", "type": "product", "category": "canned_goods"},
    "Cash desk": {"display_name": "Checkout Counter", "type": "checkout", "category": "checkout", "merge_as": "checkout_counter"},
    "Register_#1": {"display_name": "Checkout Counter", "type": "checkout", "category": "checkout", "merge_as": "checkout_counter"},
    "Register_#2": {"display_name": "Checkout Counter", "type": "checkout", "category": "checkout", "merge_as": "checkout_counter"},
    "Register_#3": {"display_name": "Checkout Counter", "type": "checkout", "category": "checkout", "merge_as": "checkout_counter"},
    "Monitor_#1": {"display_name": "Checkout Counter", "type": "checkout", "category": "checkout", "merge_as": "checkout_counter"},
    "Monitor_#2": {"display_name": "Checkout Counter", "type": "checkout", "category": "checkout", "merge_as": "checkout_counter"},
    "Monitor_#3": {"display_name": "Checkout Counter", "type": "checkout", "category": "checkout", "merge_as": "checkout_counter"},
    "Cube": {"display_name": "Shelving / Fixtures", "type": "structure", "category": "structure"},
    "Bodyframe": {"display_name": "Shelf Frame", "type": "structure", "category": "structure"},
    "Plane": {"display_name": "Floor / Wall", "type": "structure", "category": "structure"},
    "Text": {"display_name": "Signage Text", "type": "structure", "category": "structure"},
}
# Zone types that represent real shoppable products (used to filter analytics).
ATTENTION_RELEVANT_TYPES = {"product", "checkout", "ad"}
# Sketchfab/Blender glTF export convention: a transform-bearing "container" node
# (e.g. "trix.004") owns one or more untransformed "leaf" mesh nodes, one per
# material slot (e.g. "trix.004_Material.019_0"). Both share one world position;
# without stripping this suffix we'd count each physical item 2-3x.
MATERIAL_LEAF_SUFFIX_RE = re.compile(r"_Material(\.\d+)?_\d+$")
# Cluster instances of the same product within this world-space radius into
# one physical "shelf" zone (units match the GLB's own translation units).
SHELF_CLUSTER_RADIUS = 120.0


def read_glb(path: Path) -> dict:
    data = path.read_bytes()
    magic, version, _length = struct.unpack("<4sII", data[0:12])
    if magic != b"glTF":
        raise ValueError(f"{path} is not a binary glTF (.glb) file")
    offset = 12
    json_chunk = None
    while offset < len(data):
        chunk_len, chunk_type = struct.unpack("<II", data[offset : offset + 8])
        chunk_data = data[offset + 8 : offset + 8 + chunk_len]
        if chunk_type == 0x4E4F534A:  # 'JSON'
            json_chunk = chunk_data
            break
        offset += 8 + chunk_len
    if json_chunk is None:
        raise ValueError("No JSON chunk found in GLB")
    return json.loads(json_chunk)


def mat4_identity() -> list[float]:
    return [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]


def mat4_mult(a: list[float], b: list[float]) -> list[float]:
    """Column-major 4x4 multiply, matching glTF's matrix convention (result = a * b)."""
    out = [0.0] * 16
    for col in range(4):
        for row in range(4):
            s = 0.0
            for k in range(4):
                s += a[k * 4 + row] * b[col * 4 + k]
            out[col * 4 + row] = s
    return out


def mat4_from_trs(translation, rotation, scale) -> list[float]:
    tx, ty, tz = translation
    qx, qy, qz, qw = rotation
    sx, sy, sz = scale

    x2, y2, z2 = qx + qx, qy + qy, qz + qz
    xx, xy, xz = qx * x2, qx * y2, qx * z2
    yy, yz, zz = qy * y2, qy * z2, qz * z2
    wx, wy, wz = qw * x2, qw * y2, qw * z2

    m00 = (1 - (yy + zz)) * sx
    m01 = (xy + wz) * sx
    m02 = (xz - wy) * sx
    m10 = (xy - wz) * sy
    m11 = (1 - (xx + zz)) * sy
    m12 = (yz + wx) * sy
    m20 = (xz + wy) * sz
    m21 = (yz - wx) * sz
    m22 = (1 - (xx + yy)) * sz

    return [m00, m01, m02, 0.0, m10, m11, m12, 0.0, m20, m21, m22, 0.0, tx, ty, tz, 1.0]


def local_matrix(node: dict) -> list[float]:
    if "matrix" in node:
        return [float(v) for v in node["matrix"]]
    translation = node.get("translation", [0.0, 0.0, 0.0])
    rotation = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
    scale = node.get("scale", [1.0, 1.0, 1.0])
    return mat4_from_trs(translation, rotation, scale)


def is_ignored(name: str | None) -> bool:
    if not name:
        return True
    return any(re.search(pattern, name) for pattern in IGNORE_NAME_PATTERNS)


def product_key_from_name(name: str) -> str:
    """Strip Blender/Sketchfab duplicate-instance suffix, e.g. 'trix.014' -> 'trix'."""
    return TRAILING_INDEX_RE.sub("", name).strip()


def display_name_from_key(key: str) -> str:
    cleaned = key.replace("_#1", "").replace("_", " ").strip()
    return " ".join(word.capitalize() for word in cleaned.split())


def cluster_instances(instances: list[dict]) -> None:
    """Union-find clustering of same-product instances within SHELF_CLUSTER_RADIUS
    of each other, mutating each instance dict with a 'shelf_cluster' index
    (local to its product_key).
    """
    by_key: dict[str, list[dict]] = {}
    for inst in instances:
        by_key.setdefault(inst["product_key"], []).append(inst)

    for key, group in by_key.items():
        n = len(group)
        parent = list(range(n))

        def find(i: int) -> int:
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        def union(i: int, j: int) -> None:
            ri, rj = find(i), find(j)
            if ri != rj:
                parent[ri] = rj

        for i in range(n):
            for j in range(i + 1, n):
                ax, ay, az = group[i]["position"]
                bx, by, bz = group[j]["position"]
                dist = ((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2) ** 0.5
                if dist <= SHELF_CLUSTER_RADIUS:
                    union(i, j)

        roots = {}
        for i in range(n):
            r = find(i)
            if r not in roots:
                roots[r] = len(roots)
            group[i]["shelf_cluster"] = roots[r]


def main() -> None:
    if not MODEL_PATH.exists():
        raise SystemExit(f"Model not found at {MODEL_PATH}")

    gltf = read_glb(MODEL_PATH)
    nodes = gltf["nodes"]
    scenes = gltf.get("scenes", [])
    scene = scenes[gltf.get("scene", 0)] if scenes else {"nodes": []}

    world_matrices: dict[int, list[float]] = {}
    parent_of: dict[int, int] = {}

    def visit(node_index: int, parent_world: list[float]) -> None:
        node = nodes[node_index]
        world = mat4_mult(parent_world, local_matrix(node))
        world_matrices[node_index] = world
        for child_index in node.get("children", []):
            parent_of[child_index] = node_index
            visit(child_index, world)

    for root_index in scene.get("nodes", []):
        visit(root_index, mat4_identity())

    # Group every mesh-holding "leaf" node by its physical placement (its
    # container parent, or itself if it has no meaningfully-named parent) so a
    # single physical item with multiple material slots is counted exactly once.
    groups: dict[int, dict] = {}  # keyed by the representative node index
    for index, node in enumerate(nodes):
        if "mesh" not in node:
            continue  # only leaf mesh nodes carry geometry
        parent_index = parent_of.get(index)
        parent_node = nodes[parent_index] if parent_index is not None else None
        parent_name = parent_node.get("name") if parent_node else None

        if parent_name and not is_ignored(parent_name) and not MATERIAL_LEAF_SUFFIX_RE.search(parent_name):
            rep_index, rep_name = parent_index, parent_name
        else:
            leaf_name = node.get("name") or ""
            rep_index, rep_name = index, MATERIAL_LEAF_SUFFIX_RE.sub("", leaf_name)

        if is_ignored(rep_name):
            continue
        group = groups.setdefault(
            rep_index, {"node_index": rep_index, "node_name": rep_name, "leaf_names": []}
        )
        # This is the exact Object3D.name Three.js's GLTFLoader will assign to the
        # raycastable Mesh - the frontend needs this list (not the container name)
        # to map a raycast hit back to a zone_id at runtime.
        group["leaf_names"].append(node.get("name") or "")

    instances: list[dict] = []
    for group in groups.values():
        world = world_matrices.get(group["node_index"])
        if world is None:
            continue
        position = [world[12], world[13], world[14]]
        key = product_key_from_name(group["node_name"])
        instances.append(
            {
                "node_index": group["node_index"],
                "node_name": group["node_name"],
                "product_key": key,
                "position": position,
                "leaf_node_names": group["leaf_names"],
            }
        )

    cluster_instances(instances)

    # Build zone records: one per (product_key, shelf_cluster) with a bounding box,
    # collapsing curated groups (e.g. all checkout fixtures) via "merge_as".
    zones_by_id: dict[str, dict] = {}
    for inst in instances:
        catalog_entry = PRODUCT_CATALOG.get(inst["product_key"], {})
        merge_as = catalog_entry.get("merge_as")
        zone_id = merge_as or f"{inst['product_key']}__shelf{inst['shelf_cluster']}".replace(" ", "_")
        zone_type = catalog_entry.get("type", "product")
        display_name = catalog_entry.get("display_name") or display_name_from_key(inst["product_key"])
        category = catalog_entry.get("category", "uncategorized")

        zone = zones_by_id.setdefault(
            zone_id,
            {
                "zone_id": zone_id,
                "type": zone_type,
                "category": category,
                "product_key": inst["product_key"],
                "display_name": display_name,
                "instance_count": 0,
                # Exact Three.js Mesh.name values that raycast hits will report -
                # the frontend builds a mesh-name -> zone_id lookup from this.
                "mesh_node_names": [],
                "min": list(inst["position"]),
                "max": list(inst["position"]),
            },
        )
        zone["instance_count"] += 1
        zone["mesh_node_names"].extend(inst["leaf_node_names"])
        for axis in range(3):
            zone["min"][axis] = min(zone["min"][axis], inst["position"][axis])
            zone["max"][axis] = max(zone["max"][axis], inst["position"][axis])

    zones = []
    for zone in zones_by_id.values():
        center = [(zone["min"][i] + zone["max"][i]) / 2 for i in range(3)]
        # Pad a small margin around single-instance zones so raycasts/AABB tests
        # against a zero-volume box still register hits.
        margin = 40.0
        zone["min"] = [zone["min"][i] - margin for i in range(3)]
        zone["max"] = [zone["max"][i] + margin for i in range(3)]
        zone["center"] = center
        zones.append(zone)

    zones.sort(key=lambda z: (z["product_key"], z["zone_id"]))

    all_positions = [inst["position"] for inst in instances]
    bounds = {
        "min": [min(p[i] for p in all_positions) for i in range(3)] if all_positions else [0, 0, 0],
        "max": [max(p[i] for p in all_positions) for i in range(3)] if all_positions else [0, 0, 0],
    }

    output = {
        "source_model": MODEL_PATH.name,
        "store_bounds": bounds,
        "attention_relevant_types": sorted(ATTENTION_RELEVANT_TYPES),
        "product_instance_count": len(instances),
        "zone_count": len(zones),
        "zones": zones,
        "instances": instances,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(f"Wrote {len(zones)} zones from {len(instances)} product instances -> {OUTPUT_PATH}")
    print("Distinct product_keys:", sorted({inst['product_key'] for inst in instances}))
    print("Store bounds:", bounds)


if __name__ == "__main__":
    main()
