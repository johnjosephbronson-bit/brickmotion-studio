import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls, RoundedBox } from "@react-three/drei";
import { partImageUrls, partProxyUrl, type FigColors, type Pose, type TexKind, type TexStatus } from "@/lib/minifig";

const d = (deg: number) => (deg * Math.PI) / 180;

export type TexReport = (kind: TexKind, status: TexStatus, detail?: string) => void;

// ---------- BrickLink picture -> texture ----------

function probe(url: string, cors: boolean): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Tries each URL with CORS (needed to draw it into a canvas / WebGL texture). If none works,
// retries without CORS to tell "image exists but the host blocks browser use" from "no such image".
async function loadImage(urls: string[]): Promise<{ img: HTMLImageElement | null; status: "ok" | "cors" | "missing"; url?: string }> {
  let blocked: string | undefined;
  for (const url of urls) {
    const img = await probe(url, true);
    if (img) return { img, status: "ok", url };
    if (!blocked && (await probe(url, false))) blocked = url;
  }
  return { img: null, status: blocked ? "cors" : "missing", url: blocked };
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

// `upload` (an object URL of a part photo the user saved from BrickLink) replaces the network
// fetch and goes through the same crop/unwrap, so it also works when BrickLink blocks CORS.
function usePartTexture(part: FigColors["torsoPart"], kind: TexKind, upload: string | null | undefined, report?: TexReport) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const reportRef = useRef(report);
  useEffect(() => { reportRef.current = report; });
  const key = `${part ? `${part.id}|${part.colorName}` : ""}|${upload ?? ""}`;
  useEffect(() => {
    let alive = true;
    let made: THREE.Texture | null = null;
    const say = (s: TexStatus, detail?: string) => { if (alive) reportRef.current?.(kind, s, detail); };
    setTex(null);
    if (!upload) {
      if (!part) { say("none"); return () => { alive = false; }; }
      if (!/pb|px|p\d/i.test(part.id)) { say("noprint"); return () => { alive = false; }; } // plain parts have no print
    }
    say("loading");
    // our own /api/part-image proxy first (same origin, so no CORS), BrickLink direct as a fallback
    const urls = upload ? [upload] : part ? [partProxyUrl(part.id, part.colorName), ...partImageUrls(part.id, part.colorName)] : [];
    loadImage(urls).then(({ img, status, url }) => {
      if (!alive) return;
      if (!img) {
        console.warn(`[brickmotion] ${kind} texture: ${status}`, url ?? urls);
        say(status === "ok" ? "error" : status, url);
        return;
      }
      try {
        made = kind === "torso" ? torsoTexture(img) : headTexture(img);
        setTex(made);
        say("ok", url);
      } catch (err) {
        console.warn(`[brickmotion] ${kind} texture failed`, err);
        say("error");
      }
    });
    return () => { alive = false; made?.dispose(); };
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
      pos.setX(i, pos.getX(i) * (top ? 1.44 : 1.56));
      pos.setZ(i, pos.getZ(i) * (top ? 0.97 : 1));
    }
    g.computeVertexNormals();
    return g;
  }, []);
}

// Head: rounded cylinder made with a lathe profile.
function useHeadGeometry() {
  return useMemo(() => {
    const r = 0.43, h = 0.7, b = 0.09;
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
  // Pivot sits at the torso's top corner (torso top = y 2.81); the arm hangs straight down.
  return (
    <group position={[0.9 * side, 2.6, 0]}>
      <group rotation={[d(angle), 0, 0]}>
        {/* rounded shoulder */}
        <mesh castShadow>
          <sphereGeometry args={[0.19, 24, 16]} />
          <Plastic color={colors.arms} />
        </mesh>
        {/* straight arm */}
        <mesh position={[0, -0.41, 0]} castShadow>
          <cylinderGeometry args={[0.19, 0.16, 0.82, 24]} />
          <Plastic color={colors.arms} />
        </mesh>
        {/* hand: wrist peg + C-clip */}
        <group position={[0, -0.86, 0]} rotation={[0, d(twist), 0]}>
          <mesh position={[0, 0.02, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.09, 0.14, 16]} />
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
      <RoundedBox args={[0.74, 0.22, 0.9]} radius={0.04} position={[0, -1.07, 0.06]} castShadow>
        <Plastic color={colors.legs} />
      </RoundedBox>
    </group>
  );
}

type Uploads = Partial<Record<TexKind, string | null>>;

function Minifig({ pose, colors, uploads, onTexture }: { pose: Pose; colors: FigColors; uploads?: Uploads; onTexture?: TexReport }) {
  const torsoGeo = useTorsoGeometry();
  const headGeo = useHeadGeometry();
  // Front face of the torso (a trapezoid). torsoTexture() flattens the print row by row, so each
  // row of this mesh must span u = 0..1 across *its own* width. A single 4-vertex quad can't do
  // that (two triangles interpolate affinely and shear the print), so build it as thin row strips.
  const frontGeo = useMemo(() => {
    const e = 0.004, hh = 0.64, rows = 24;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= rows; i++) {
      const f = i / rows; // 0 = waist, 1 = shoulders
      const half = 0.78 + (0.72 - 0.78) * f;
      const z = 0.39 + (0.378 - 0.39) * f + e;
      const y = -hh + 2 * hh * f;
      pos.push(-half, y, z, half, y, z);
      uv.push(0, f, 1, f);
      if (i < rows) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, []);
  const torsoTex = usePartTexture(colors.torsoPart, "torso", uploads?.torso, onTexture);
  const headTex = usePartTexture(colors.headPart, "head", uploads?.head, onTexture);

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
        <mesh geometry={headGeo} position={[0, 0.43, 0]} castShadow>
          <Plastic color={colors.head} />
        </mesh>
        {/* printed face strip (front half of the head) */}
        {headTex ? (
          <mesh position={[0, 0.43, 0]}>
            <cylinderGeometry args={[0.433, 0.433, 0.5, 48, 1, true, -Math.PI / 2, Math.PI]} />
            <meshPhysicalMaterial map={headTex} roughness={0.22} clearcoat={0.6} clearcoatRoughness={0.25} />
          </mesh>
        ) : (
          <>
            {[-0.15, 0.15].map((x) => (
              <mesh key={x} position={[x, 0.49, 0.415]} scale={[1, 1.35, 0.35]}>
                <sphereGeometry args={[0.05, 12, 12]} />
                <meshStandardMaterial color="#1b1b1b" />
              </mesh>
            ))}
            <mesh position={[0, 0.36, 0.41]} rotation={[0, 0, Math.PI]}>
              <torusGeometry args={[0.15, 0.02, 8, 24, Math.PI]} />
              <meshStandardMaterial color="#1b1b1b" />
            </mesh>
          </>
        )}
        {/* hollow top stud */}
        <mesh position={[0, 0.86, 0]}>
          <cylinderGeometry args={[0.23, 0.23, 0.16, 32, 1, true]} />
          <meshPhysicalMaterial color={colors.head} side={THREE.DoubleSide} roughness={0.22} clearcoat={0.6} />
        </mesh>
        <mesh position={[0, 0.81, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0, 0.23, 32]} />
          <Plastic color={colors.head} />
        </mesh>
        {colors.hair && (
          <mesh position={[0, 0.66, -0.04]} scale={[1.08, 0.85, 1.08]} castShadow>
            <sphereGeometry args={[0.5, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
            <Plastic color={colors.hair} />
          </mesh>
        )}
        {colors.hat && (
          <group position={[0, 0.84, 0]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.44, 0.46, 0.34, 32]} />
              <Plastic color={colors.hat} />
            </mesh>
            <mesh position={[0, -0.13, 0.2]}>
              <cylinderGeometry args={[0.6, 0.6, 0.06, 32]} />
              <Plastic color={colors.hat} />
            </mesh>
          </group>
        )}
      </group>
    </group>
  );
}

export default function MinifigScene({
  pose, colors, onCanvas, ground, uploads, onTexture,
}: {
  pose: Pose; colors: FigColors; onCanvas: (c: HTMLCanvasElement) => void; ground: string;
  uploads?: Uploads; onTexture?: TexReport;
}) {
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
      <Minifig pose={pose} colors={colors} uploads={uploads} onTexture={onTexture} />
      <ContactShadows position={[0, 0, 0]} opacity={0.45} scale={10} blur={2.2} far={4} />
      <OrbitControls target={[0, 2, 0]} enablePan={false} minDistance={4} maxDistance={16} />
    </Canvas>
  );
}
