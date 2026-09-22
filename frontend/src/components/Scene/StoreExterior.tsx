import { useMemo } from "react";
import * as THREE from "three";
import { STORE_BOUNDS, FLOOR_Y } from "./storeBounds";

/** Procedurally-built store exterior: convenience_store.glb (see
 * storeBounds.ts) contains ONLY interior shelving/products/checkout - no
 * walls, roof, doors, or anything outside at all. The challenge explicitly
 * calls out "outside the store" and "banners on open-space billboards" as
 * a bonus, so rather than sourcing/licensing/re-rigging an entire unrelated
 * exterior GLB (which would also need its own zone-extraction pass to stay
 * comparable to the existing product/ad attention pipeline), we wrap a
 * lightweight brick building shell + entrance + parking lot around the
 * SAME interior model's bounds. This keeps every existing zone id, mesh
 * name, and analytics pipeline untouched - it's a pure visual/spatial
 * addition, not a new data source.
 *
 * All textures are generated on <canvas> at runtime (brick, asphalt) so
 * there's no extra asset to download/license - same pattern as the
 * existing ad-banner creative in AdBanners.tsx.
 *
 * The building's front (entrance) faces -Z, matching the interior's own
 * layout: checkout_counter sits at z≈-3.25 (the most-negative-Z zone) and
 * the default camera spawn faces -Z, so walking "forward" from spawn
 * naturally exits past checkout and out through this door - no spawn point
 * or control changes needed.
 */

const PADDING = 3; // metres of clearance between the GLB's bounds and the shell, so nothing clips
const WALL_HEIGHT = 8.6;
const WALL_THICKNESS = 0.4;
const ROOF_THICKNESS = 0.3;
const DOOR_WIDTH = 4;
const DOOR_HEIGHT = 3.6;

const X_MIN = STORE_BOUNDS.min[0] - PADDING;
const X_MAX = STORE_BOUNDS.max[0] + PADDING;
const Z_FRONT = STORE_BOUNDS.min[2] - PADDING; // entrance side (most negative Z)
const Z_BACK = STORE_BOUNDS.max[2] + PADDING;

const BUILDING_WIDTH = X_MAX - X_MIN;
const BUILDING_DEPTH = Z_BACK - Z_FRONT;
const CENTER_X = (X_MIN + X_MAX) / 2;
const CENTER_Z = (Z_FRONT + Z_BACK) / 2;
const WALL_TOP = FLOOR_Y + WALL_HEIGHT;
const WALL_MID_Y = FLOOR_Y + WALL_HEIGHT / 2;
const FRONT_WALL_Z = Z_FRONT + WALL_THICKNESS / 2;

const DOOR_HALF = DOOR_WIDTH / 2;
const LEFT_SEG_WIDTH = -DOOR_HALF - X_MIN;
const LEFT_SEG_CENTER_X = (X_MIN + -DOOR_HALF) / 2;
const RIGHT_SEG_WIDTH = X_MAX - DOOR_HALF;
const RIGHT_SEG_CENTER_X = (DOOR_HALF + X_MAX) / 2;
const HEADER_HEIGHT = WALL_HEIGHT - DOOR_HEIGHT;
const HEADER_CENTER_Y = FLOOR_Y + DOOR_HEIGHT + HEADER_HEIGHT / 2;

function makeBrickTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#7a3b2e"; // mortar base
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const brickW = 64;
  const brickH = 24;
  const mortar = 4;
  let row = 0;
  for (let y = 0; y < canvas.height; y += brickH + mortar) {
    const offset = row % 2 === 0 ? 0 : -brickW / 2;
    for (let x = -brickW; x < canvas.width + brickW; x += brickW + mortar) {
      const hue = 8 + Math.random() * 10;
      const light = 32 + Math.random() * 10;
      ctx.fillStyle = `hsl(${hue}, 55%, ${light}%)`;
      ctx.fillRect(x + offset, y, brickW, brickH);
    }
    row += 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function makeAsphaltTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#2c2e31";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // subtle speckle noise for texture
  for (let i = 0; i < 4000; i++) {
    const shade = 30 + Math.random() * 25;
    ctx.fillStyle = `rgba(${shade + 10}, ${shade + 10}, ${shade + 12}, 0.5)`;
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1.5, 1.5);
  }
  // painted parking-stall divider lines
  ctx.strokeStyle = "rgba(230, 220, 180, 0.85)";
  ctx.lineWidth = 6;
  for (let x = 40; x < canvas.width; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, canvas.height * 0.55);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function makeSignTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#101418";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffcf3f";
  ctx.font = "bold 130px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("FreshMart", canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** Disables raycasting for purely decorative/structural meshes (walls, roof,
 * windows, signs, doors). Without this, FirstPersonControls' straight-down
 * floor-height probe (see FirstPersonControls.tsx) can register a hit
 * against a vertical wall/roof face - since a Mesh's `raycast()` tests the
 * ray against its full triangle set in local space, a tall thin box can
 * still report an intersection point whose *world* x/z the eye misreads as
 * "under the camera" once transformed back, snapping the camera's eye
 * height up onto the roof. Only actual walkable ground (the parking lot +
 * sidewalk planes below) should ever answer that probe.
 */
const NO_RAYCAST = () => null;

const GLASS_PROPS = {
  color: "#bfe3f0",
  transparent: true,
  opacity: 0.35,
  metalness: 0.2,
  roughness: 0.05,
  side: THREE.DoubleSide,
} as const;

function Window({ x, y }: { x: number; y: number }) {
  return (
    <group position={[x, y, Z_FRONT - 0.03]}>
      <mesh raycast={NO_RAYCAST}>
        <planeGeometry args={[3.4, 2.6]} />
        <meshStandardMaterial color="#1a1a1a" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 0.02]} raycast={NO_RAYCAST}>
        <planeGeometry args={[3, 2.2]} />
        <meshPhysicalMaterial {...GLASS_PROPS} />
      </mesh>
    </group>
  );
}

export function StoreExterior() {
  const brick = useMemo(() => {
    const tex = makeBrickTexture();
    tex.repeat.set(BUILDING_WIDTH / 3, WALL_HEIGHT / 1.5);
    return tex;
  }, []);
  const brickSide = useMemo(() => {
    const tex = makeBrickTexture();
    tex.repeat.set(BUILDING_DEPTH / 3, WALL_HEIGHT / 1.5);
    return tex;
  }, []);
  const asphalt = useMemo(() => {
    const tex = makeAsphaltTexture();
    tex.repeat.set(14, 14);
    return tex;
  }, []);
  const signTexture = useMemo(() => makeSignTexture(), []);

  return (
    <group>
      {/* Parking lot / open space ground - one large plane so there's no
          seam/gap between it and the interior's own floor at the doorway. */}
      <mesh position={[CENTER_X, FLOOR_Y - 0.03, Z_FRONT - 30]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[140, 140]} />
        <meshStandardMaterial map={asphalt} roughness={1} />
      </mesh>

      {/* Sidewalk strip right at the entrance */}
      <mesh position={[0, FLOOR_Y - 0.02, Z_FRONT - 3]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[10, 6]} />
        <meshStandardMaterial color="#9a9a92" roughness={0.9} />
      </mesh>

      {/* Back wall */}
      <mesh position={[CENTER_X, WALL_MID_Y, Z_BACK - WALL_THICKNESS / 2]} castShadow receiveShadow raycast={NO_RAYCAST}>
        <boxGeometry args={[BUILDING_WIDTH, WALL_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial map={brick} roughness={0.95} />
      </mesh>
      {/* Left wall */}
      <mesh position={[X_MIN + WALL_THICKNESS / 2, WALL_MID_Y, CENTER_Z]} castShadow receiveShadow raycast={NO_RAYCAST}>
        <boxGeometry args={[WALL_THICKNESS, WALL_HEIGHT, BUILDING_DEPTH]} />
        <meshStandardMaterial map={brickSide} roughness={0.95} />
      </mesh>
      {/* Right wall */}
      <mesh position={[X_MAX - WALL_THICKNESS / 2, WALL_MID_Y, CENTER_Z]} castShadow receiveShadow raycast={NO_RAYCAST}>
        <boxGeometry args={[WALL_THICKNESS, WALL_HEIGHT, BUILDING_DEPTH]} />
        <meshStandardMaterial map={brickSide} roughness={0.95} />
      </mesh>

      {/* Front facade, split around the entrance gap */}
      <mesh position={[LEFT_SEG_CENTER_X, WALL_MID_Y, FRONT_WALL_Z]} castShadow receiveShadow raycast={NO_RAYCAST}>
        <boxGeometry args={[LEFT_SEG_WIDTH, WALL_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial map={brick} roughness={0.95} />
      </mesh>
      <mesh position={[RIGHT_SEG_CENTER_X, WALL_MID_Y, FRONT_WALL_Z]} castShadow receiveShadow raycast={NO_RAYCAST}>
        <boxGeometry args={[RIGHT_SEG_WIDTH, WALL_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial map={brick} roughness={0.95} />
      </mesh>
      <mesh position={[CENTER_X, HEADER_CENTER_Y, FRONT_WALL_Z]} castShadow receiveShadow raycast={NO_RAYCAST}>
        <boxGeometry args={[BUILDING_WIDTH, HEADER_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial map={brick} roughness={0.95} />
      </mesh>

      {/* Roof */}
      <mesh position={[CENTER_X, WALL_TOP + ROOF_THICKNESS / 2, CENTER_Z]} receiveShadow raycast={NO_RAYCAST}>
        <boxGeometry args={[BUILDING_WIDTH + 0.6, ROOF_THICKNESS, BUILDING_DEPTH + 0.6]} />
        <meshStandardMaterial color="#2f2f33" roughness={0.9} />
      </mesh>

      {/* Storefront sign above the entrance */}
      <mesh position={[CENTER_X, FLOOR_Y + DOOR_HEIGHT + 1.4, FRONT_WALL_Z + 0.03]} raycast={NO_RAYCAST}>
        <planeGeometry args={[9, 1.8]} />
        <meshStandardMaterial map={signTexture} toneMapped={false} />
      </mesh>

      {/* Decorative storefront windows either side of the door */}
      <Window x={LEFT_SEG_CENTER_X} y={FLOOR_Y + 2.9} />
      <Window x={RIGHT_SEG_CENTER_X} y={FLOOR_Y + 2.9} />

      {/* Glass double doors filling the entrance gap */}
      <mesh position={[-1.05, FLOOR_Y + DOOR_HEIGHT / 2, FRONT_WALL_Z]} raycast={NO_RAYCAST}>
        <planeGeometry args={[1.9, DOOR_HEIGHT]} />
        <meshPhysicalMaterial {...GLASS_PROPS} />
      </mesh>
      <mesh position={[1.05, FLOOR_Y + DOOR_HEIGHT / 2, FRONT_WALL_Z]} raycast={NO_RAYCAST}>
        <planeGeometry args={[1.9, DOOR_HEIGHT]} />
        <meshPhysicalMaterial {...GLASS_PROPS} />
      </mesh>
      {/* Thin center frame - offset slightly above head height so it can't
          be walked straight through at eye level (x=0 is exactly the
          default spawn/walk line). */}
      <mesh position={[0, FLOOR_Y + DOOR_HEIGHT - 0.15, FRONT_WALL_Z]} raycast={NO_RAYCAST}>
        <boxGeometry args={[0.08, 0.3, WALL_THICKNESS + 0.02]} />
        <meshStandardMaterial color="#2a2a2a" metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}
