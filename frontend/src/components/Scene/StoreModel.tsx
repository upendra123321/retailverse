import { useGLTF } from "@react-three/drei";

const MODEL_URL = "/api/model";

export function StoreModel() {
  const { scene } = useGLTF(MODEL_URL);
  return <primitive object={scene} />;
}

useGLTF.preload(MODEL_URL);
