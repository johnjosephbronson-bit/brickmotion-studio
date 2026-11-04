import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import type { FigColors, Pose } from "@/lib/minifig";

const d = (deg: number) => (deg * Math.PI) / 180;

function Plastic({ color }: { color: string }) {
  return <meshStandardMaterial color={color} roughness={0.28} metalness={0.02} />;
}

function Arm({ side, angle, twist, colors }: { side: 1 | -1; angle: number; twist: number; colors: FigColors }) {
  return (
    <group position={[0.72 * side, 2.45, 0]} rotation={[0, 0, d(8) * side]}>
      <group rotation={[d(angle), 0, 0]}>
        <mesh position={[0.08 * side, -0.05, 0]} castShadow>
          <sphereGeometry args={[0.2, 20, 16]} />
          <Plastic color={colors.arms} />
        </mesh>
        <mesh position={[0.1 * side, -0.42, 0.06]} rotation={[d(-10), 0, 0]} castShadow>
          <cylinderGeometry args={[0.17, 0.16, 0.75, 20]} />
          <Plastic color={colors.arms} />
        </mesh>
        <group position={[0.1 * side, -0.88, 0.17]} rotation={[d(-35), d(twist), 0]}>
          <mesh position={[0, 0.06, 0]} castShadow>
            <cylinderGeometry args={[0.08, 0.08, 0.16, 12]} />
            <Plastic color={colors.hands} />
          </mesh>
          <mesh position={[0, -0.1, 0]} rotation={[0, d(90), d(90)]} castShadow>
            <torusGeometry args={[0.13, 0.06, 12, 24, Math.PI * 1.5]} />
            <Plastic color={colors.hands} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function Leg({ side, angle, colors }: { side: 1 | -1; angle: number; colors: FigColors }) {
  return (
    <group position={[0.4 * side, 1.3, 0]} rotation={[d(angle), 0, 0]}>
      <mesh position={[0, -0.6, 0]} castShadow>
        <boxGeometry args={[0.76, 1.15, 0.75]} />
        <Plastic color={colors.legs} />
      </mesh>
      <mesh position={[0, -1.17, 0.1]} castShadow>
        <boxGeometry args={[0.76, 0.26, 0.95]} />
        <Plastic color={colors.legs} />
      </mesh>
    </group>
  );
}

function Minifig({ pose, colors }: { pose: Pose; colors: FigColors }) {
  return (
    <group position={[0, pose.bodyY, 0]} rotation={[d(pose.tilt), d(pose.bodyRot), 0]}>
      <Leg side={1} angle={pose.legL} colors={colors} />
      <Leg side={-1} angle={pose.legR} colors={colors} />
      <mesh position={[0, 1.42, 0]} castShadow>
        <boxGeometry args={[1.58, 0.3, 0.75]} />
        <Plastic color={colors.hips} />
      </mesh>
      <mesh position={[0, 2.06, 0]} rotation={[0, Math.PI / 4, 0]} scale={[1, 1, 1]} castShadow>
        <cylinderGeometry args={[0.85, 1.12, 1.2, 4]} />
        <Plastic color={colors.torso} />
      </mesh>
      <Arm side={1} angle={pose.armL} twist={pose.handL} colors={colors} />
      <Arm side={-1} angle={pose.armR} twist={-pose.handR} colors={colors} />
      <group position={[0, 2.66, 0]} rotation={[0, d(pose.headY), 0]}>
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.24, 0.24, 0.12, 20]} />
          <Plastic color={colors.head} />
        </mesh>
        <mesh position={[0, 0.42, 0]} castShadow>
          <cylinderGeometry args={[0.42, 0.42, 0.6, 32]} />
          <Plastic color={colors.head} />
        </mesh>
        <mesh position={[0, 0.76, 0]}>
          <cylinderGeometry args={[0.25, 0.25, 0.14, 24]} />
          <Plastic color={colors.head} />
        </mesh>
        {[-0.14, 0.14].map((x) => (
          <mesh key={x} position={[x, 0.5, 0.405]} scale={[1, 1.3, 0.4]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshStandardMaterial color="#1b1b1b" />
          </mesh>
        ))}
        <mesh position={[0, 0.36, 0.4]} rotation={[0, 0, Math.PI]}>
          <torusGeometry args={[0.15, 0.022, 8, 24, Math.PI]} />
          <meshStandardMaterial color="#1b1b1b" />
        </mesh>
        {colors.hair && (
          <mesh position={[0, 0.62, -0.03]} scale={[1, 0.8, 1]} castShadow>
            <sphereGeometry args={[0.5, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
            <Plastic color={colors.hair} />
          </mesh>
        )}
        {colors.hat && (
          <group position={[0, 0.78, 0]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.46, 0.48, 0.32, 32]} />
              <Plastic color={colors.hat} />
            </mesh>
            <mesh position={[0, -0.12, 0.2]}>
              <cylinderGeometry args={[0.62, 0.62, 0.06, 32]} />
              <Plastic color={colors.hat} />
            </mesh>
          </group>
        )}
      </group>
    </group>
  );
}

export default function MinifigScene({
  pose, colors, onCanvas, ground,
}: { pose: Pose; colors: FigColors; onCanvas: (c: HTMLCanvasElement) => void; ground: string }) {
  return (
    <Canvas
      shadows
      camera={{ position: [4.5, 3.4, 6.5], fov: 35 }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onCreated={({ gl }) => onCanvas(gl.domElement)}
    >
      <color attach="background" args={[ground]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 5]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-6, 3, -4]} intensity={0.6} />
      <Minifig pose={pose} colors={colors} />
      <ContactShadows position={[0, 0, 0]} opacity={0.45} scale={10} blur={2.2} far={4} />
      <OrbitControls target={[0, 1.9, 0]} enablePan={false} minDistance={4} maxDistance={16} />
    </Canvas>
  );
}
