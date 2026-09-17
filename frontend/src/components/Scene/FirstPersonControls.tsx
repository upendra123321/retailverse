import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import * as THREE from "three";

const MOVE_SPEED = 3.2; // meters/second
const EYE_HEIGHT = 2.2; // meters above the floor
const GROUND_PROBE_HEIGHT = 5; // start the downward raycast this high above the camera

/** WASD + mouse-look first-person navigation with floor-height snapping. */
export function FirstPersonControls() {
  const { camera, scene } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const raycaster = useRef(new THREE.Raycaster());

  useEffect(() => {
    const down = (e: KeyboardEvent) => (keys.current[e.code] = true);
    const up = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    camera.position.set(0, EYE_HEIGHT, 4);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [camera]);

  useFrame((_, delta) => {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 0) forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();

    const move = new THREE.Vector3();
    if (keys.current["KeyW"] || keys.current["ArrowUp"]) move.add(forward);
    if (keys.current["KeyS"] || keys.current["ArrowDown"]) move.sub(forward);
    if (keys.current["KeyD"] || keys.current["ArrowRight"]) move.add(right);
    if (keys.current["KeyA"] || keys.current["ArrowLeft"]) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(MOVE_SPEED * delta);
      camera.position.add(move);
    }

    // Snap camera to eye-height above whatever floor geometry is underneath it.
    raycaster.current.set(
      new THREE.Vector3(camera.position.x, camera.position.y + GROUND_PROBE_HEIGHT, camera.position.z),
      new THREE.Vector3(0, -1, 0)
    );
    const hits = raycaster.current.intersectObjects(scene.children, true);
    if (hits.length > 0) {
      camera.position.y = hits[0].point.y + EYE_HEIGHT;
    }
  });

  return <PointerLockControls />;
}
