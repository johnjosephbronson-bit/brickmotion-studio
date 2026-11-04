import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls, RoundedBox } from "@react-three/drei";
import { partImageUrls, type FigColors, type Pose } from "@/lib/minifig";

const d = (deg: number) => (deg * Math.PI) / 180;

// ---------- BrickLink picture -> texture ----------

function loadImage(urls: string[]): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const tryAt = (i: number) => {
      if (i >= urls.length) return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => tryAt(i + 1);
      img.src = urls[i]!;
    };
    tryAt(0);
  });
}

// Crop the printed front of a torso photo (BrickLink shows torsos straight-on with arms).
function torsoTexture(img: HTMLImageElement) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const g = c.getContext("2d")!;
  const w = img.naturalWidth, h = img.naturalHeight;
  // the printed front is a trapezoid in the photo: sample it row by row
  const y0 = h * 0.285, y1 = h * 0.83;
  for (let y = 0; y < 512; y++) {
    const f = (y + 0.5) / 512;
    const l = w * (0.345 + (0.235 - 0.345) * f);
    const r = w * (0.66 + (0.765 - 0.66) * f);
    g.drawImage(img, l, y0 + (y1 - y0) * f, r - l, (y1 - y0) / 512, 0, y, 512, 1);
  }
  return finish(c);
}

// Unwrap the visible half of a head photo onto a cylinder strip.
function headTexture(img: HTMLImageElement) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const g = c.getContext("2d")!;
  const w = img.naturalWidth, h = img.naturalHeight;
  const cx = w * 0.5, hw = w * 0.445;
  const sy = h * 0.33, sh = h * 0.55;
  for (let x = 0; x < 512; x++) {
    const th = -Math.PI / 2 + (Math.PI * (x + 0.5)) / 512;
    const sx = cx + Math.sin(th) * hw * 0.97;
    g.drawImage(img, sx, sy, Math.max(1, (hw * Math.PI) / 512), sh, x, 0, 1, 256);
  }
  return finish(c);
}

function finish(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function usePartTexture(part: FigColors["torsoPart"], kind: "torso" | "head") {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const key = part ? `${part.id}|${part.colorName}` : "";
  useEffect(() => {
    let alive = true;
    setTex(null);
    if (!part || !/pb|px|p\d/i.test(part.id)) return; // plain parts have no print
    loadImage(partImageUrls(part.id, part.colorName)).then((img) => {
      if (alive && img) setTex(kind === "torso" ? torsoTexture(img) : headTexture(img));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, kind]);
  return tex;
}

// ---------- geometry ----------

function Plastic({ color, map }: { color: string; map?: THREE.Texture | null }) {
  return <meshPhysicalMaterial color={map ? "#ffffff" : color} map={map ?? null} roughness={0.22} clearcoat={0.6} clearcoatRoughness={0.25} />;
}

// Trapezoid torso: narrow shoulders, wide waist, like a real minifig torso.
function useTorsoGeometry() {
  return useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1.28, 0.78, 1, 1, 1);
    const pos = g.attributes["position"] as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const top = y > 0;
      pos.setX(i, pos.getX(i) * (top ? 1.14 : 1.56));
      pos.setZ(i, pos.getZ(i) * (top ? 0.92 : 1));
    }
    g.computeVertexNormals();
    return g;
  }, []);
}

// Head: rounded cylinder made with a lathe profile.
function useHeadGeometry() {
  return useMemo(() => {
    const r = 0.47, h = 0.72, b = 0.09;
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, -h / 2)];
    for (let i = 0; i <= 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, -h / 2 + b + Math.sin(a) * b));
    }
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, h / 2 - b + Math.sin(a) * b));
    }
    pts.push(new THREE.Vector2(0, h / 2));
    return new THREE.LatheGeometry(pts, 48);
  }, []);
}

function Arm({ side, angle, twist, colors }: { side: 1 | -1; angle: number; twist: number; colors: FigColors }) {
  return (
    <group position={[0.6 * side, 2.5, 0]} rotation={[0, 0, d(6) * side]}>
      <group rotation={[d(angle), 0, 0]}>
        {/* shoulder */}
        <mesh position={[0.1 * side, -0.06, 0]} castShadow>
          <sphereGeometry args={[0.22, 24, 16]} />
          <Plastic color={colors.arms} />
        </mesh>
        {/* upper arm, angled out */}
        <mesh position={[0.17 * side, -0.32, 0.02]} rotation={[d(-6), 0, d(10) * side]} castShadow>
          <cylinderGeometry args={[0.2, 0.17, 0.55, 24]} />
          <Plastic color={colors.arms} />
        </mesh>
        {/* forearm bending forward */}
        <mesh position={[0.21 * side, -0.66, 0.16]} rotation={[d(-40), 0, d(4) * side]} castShadow>
          <cylinderGeometry args={[0.17, 0.15, 0.42, 24]} />
          <Plastic color={colors.arms} />
        </mesh>
        <group position={[0.22 * side, -0.84, 0.36]} rotation={[d(-50), d(twist), 0]}>
          <mesh position={[0, 0.05, 0]} castShadow>
            <cylinderGeometry args={[0.075, 0.075, 0.16, 16]} />
            <Plastic color={colors.hands} />
          </mesh>
          <mesh position={[0, -0.12, 0]} rotation={[0, d(90), d(135)]} castShadow>
            <torusGeometry args={[0.12, 0.065, 14, 28, Math.PI * 1.45]} />
            <Plastic color={colors.hands} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function Leg({ side, angle, colors }: { side: 1 | -1; angle: number; colors: FigColors }) {
  return (
    <group position={[0.395 * side, 1.18, 0]} rotation={[d(angle), 0, 0]}>
      {/* hip axle stub */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.2, 0.2, 0.74, 24]} />
        <Plastic color={colors.legs} />
      </mesh>
      <RoundedBox args={[0.74, 1.05, 0.78]} radius={0.04} position={[0, -0.6, 0]} castShadow>
        <Plastic color={colors.legs} />
      </RoundedBox>
      {/* foot */}
      <RoundedBox args={[0.74, 0.22, 0.98]} radius={0.04} position={[0, -1.07, 0.1]} castShadow>
        <Plastic color={colors.legs} />
      </RoundedBox>
    </group>
  );
}

function Minifig({ pose, colors }: { pose: Pose; colors: FigColors }) {
  const torsoGeo = useTorsoGeometry();
  const headGeo = useHeadGeometry();
  const frontGeo = useMemo(() => {
    const e = 0.004, hh = 0.64;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([
      -0.78, -hh, 0.39 + e, 0.78, -hh, 0.39 + e, 0.57, hh, 0.359 + e, -0.57, hh, 0.359 + e,
    ], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return g;
  }, []);
  const torsoTex = usePartTexture(colors.torsoPart, "torso");
  const headTex = usePartTexture(colors.headPart, "head");

  return (
    <group position={[0, pose.bodyY, 0]} rotation={[d(pose.tilt), d(pose.bodyRot), 0]}>
      <Leg side={1} angle={pose.legL} colors={colors} />
      <Leg side={-1} angle={pose.legR} colors={colors} />
      {/* hip block */}
      <RoundedBox args={[1.56, 0.26, 0.78]} radius={0.03} position={[0, 1.4, 0]} castShadow>
        <Plastic color={colors.hips} />
      </RoundedBox>
      {/* torso: front face gets the BrickLink print */}
      <mesh geometry={torsoGeo} position={[0, 2.17, 0]} castShadow>
        <Plastic color={colors.torso} />
      </mesh>
      {torsoTex && (
        <mesh geometry={frontGeo} position={[0, 2.17, 0]}>
          <meshPhysicalMaterial map={torsoTex} roughness={0.22} clearcoat={0.6} clearcoatRoughness={0.25} />
        </mesh>
      )}
      <Arm side={1} angle={pose.armL} twist={pose.handL} colors={colors} />
      <Arm side={-1} angle={pose.armR} twist={-pose.handR} colors={colors} />
      <group position={[0, 2.81, 0]} rotation={[0, d(pose.headY), 0]}>
        {/* neck */}
        <mesh position={[0, 0.03, 0]}>
          <cylinderGeometry args={[0.24, 0.24, 0.1, 24]} />
          <Plastic color={colors.head} />
        </mesh>
        <mesh geometry={headGeo} position={[0, 0.44, 0]} castShadow>
          <Plastic color={colors.head} />
        </mesh>
        {/* printed face strip (front half of the head) */}
        {headTex ? (
          <mesh position={[0, 0.44, 0]}>
            <cylinderGeometry args={[0.473, 0.473, 0.54, 48, 1, true, -Math.PI / 2, Math.PI]} />
            <meshPhysicalMaterial map={headTex} roughness={0.22} clearcoat={0.6} clearcoatRoughness={0.25} />
          </mesh>
        ) : (
          <>
            {[-0.15, 0.15].map((x) => (
              <mesh key={x} position={[x, 0.5, 0.455]} scale={[1, 1.35, 0.35]}>
                <sphereGeometry args={[0.05, 12, 12]} />
                <meshStandardMaterial color="#1b1b1b" />
              </mesh>
            ))}
            <mesh position={[0, 0.37, 0.45]} rotation={[0, 0, Math.PI]}>
              <torusGeometry args={[0.15, 0.02, 8, 24, Math.PI]} />
              <meshStandardMaterial color="#1b1b1b" />
            </mesh>
          </>
        )}
        {/* hollow top stud */}
        <mesh position={[0, 0.88, 0]}>
          <cylinderGeometry args={[0.25, 0.25, 0.16, 32, 1, true]} />
          <meshPhysicalMaterial color={colors.head} side={THREE.DoubleSide} roughness={0.22} clearcoat={0.6} />
        </mesh>
        <mesh position={[0, 0.83, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0, 0.25, 32]} />
          <Plastic color={colors.head} />
        </mesh>
        {colors.hair && (
          <mesh position={[0, 0.68, -0.04]} scale={[1.08, 0.85, 1.08]} castShadow>
            <sphereGeometry args={[0.5, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
            <Plastic color={colors.hair} />
          </mesh>
        )}
        {colors.hat && (
          <group position={[0, 0.86, 0]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.48, 0.5, 0.34, 32]} />
              <Plastic color={colors.hat} />
            </mesh>
            <mesh position={[0, -0.13, 0.2]}>
              <cylinderGeometry args={[0.64, 0.64, 0.06, 32]} />
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
      camera={{ position: [6.5, 4.5, 9.5], fov: 32 }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onCreated={({ gl }) => onCanvas(gl.domElement)}
    >
      <color attach="background" args={[ground]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[5, 8, 6]} intensity={2} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-6, 3, -4]} intensity={0.5} />
      <Environment resolution={128}>
        <Lightformer intensity={1.6} position={[0, 6, 2]} scale={[8, 8, 1]} />
        <Lightformer intensity={0.8} position={[-5, 2, 3]} rotation-y={Math.PI / 3} scale={[6, 2, 1]} />
        <Lightformer intensity={0.6} color="#ffe9c7" position={[5, 1, -2]} rotation-y={-Math.PI / 2} scale={[10, 2, 1]} />
      </Environment>
      <Minifig pose={pose} colors={colors} />
      <ContactShadows position={[0, 0, 0]} opacity={0.45} scale={10} blur={2.2} far={4} />
      <OrbitControls target={[0, 2, 0]} enablePan={false} minDistance={4} maxDistance={16} />
    </Canvas>
  );
}
