// Minifigure data model: parts, colors, poses and Lego-Movie-style interpolation.

export type Pose = {
  headY: number; // head turn (deg)
  armL: number; // shoulder swing (deg, negative = raise forward/up)
  armR: number;
  handL: number; // wrist twist around arm axis (deg)
  handR: number;
  legL: number; // hip swing (deg, negative = forward)
  legR: number;
  bodyY: number; // vertical offset (studs-ish units)
  bodyRot: number; // whole figure turn (deg)
  tilt: number; // whole figure lean forward/back (deg)
};

export type Keyframe = { id: string; t: number; label: string; pose: Pose };

export const JOINTS: { key: keyof Pose; label: string; min: number; max: number; step: number }[] = [
  { key: "headY", label: "Head turn", min: -180, max: 180, step: 1 },
  { key: "armL", label: "Left arm", min: -180, max: 180, step: 1 },
  { key: "armR", label: "Right arm", min: -180, max: 180, step: 1 },
  { key: "handL", label: "Left hand twist", min: -180, max: 180, step: 1 },
  { key: "handR", label: "Right hand twist", min: -180, max: 180, step: 1 },
  { key: "legL", label: "Left leg", min: -90, max: 90, step: 1 },
  { key: "legR", label: "Right leg", min: -90, max: 90, step: 1 },
  { key: "bodyY", label: "Height", min: -1, max: 3, step: 0.05 },
  { key: "bodyRot", label: "Body turn", min: -180, max: 180, step: 1 },
  { key: "tilt", label: "Lean", min: -45, max: 45, step: 1 },
];

export const NEUTRAL: Pose = {
  headY: 0, armL: 0, armR: 0, handL: 0, handR: 0, legL: 0, legR: 0, bodyY: 0, bodyRot: 0, tilt: 0,
};

const p = (o: Partial<Pose>): Pose => ({ ...NEUTRAL, ...o });

export const PRESETS: { name: string; emoji: string; pose: Pose }[] = [
  { name: "Neutral", emoji: "🧍", pose: NEUTRAL },
  { name: "Wave", emoji: "👋", pose: p({ armR: -150, handR: 35, headY: -10 }) },
  { name: "Cheer", emoji: "🙌", pose: p({ armL: -170, armR: -170, bodyY: 0.3 }) },
  { name: "Point", emoji: "👉", pose: p({ armR: -90, headY: -25, bodyRot: 15 }) },
  { name: "Walk", emoji: "🚶", pose: p({ armL: 30, armR: -30, legL: -28, legR: 28 }) },
  { name: "Run", emoji: "🏃", pose: p({ armL: 55, armR: -60, legL: -45, legR: 40, tilt: 12, bodyY: 0.25 }) },
  { name: "Jump", emoji: "⤴️", pose: p({ armL: -160, armR: -160, legL: -20, legR: 20, bodyY: 1.6 }) },
  { name: "Sit", emoji: "🪑", pose: p({ legL: -90, legR: -90, armL: -40, armR: -40, bodyY: -0.1 }) },
  { name: "Think", emoji: "🤔", pose: p({ armR: -115, handR: 70, headY: 20, tilt: -4 }) },
  { name: "Shrug", emoji: "🤷", pose: p({ armL: -45, armR: -45, handL: -60, handR: 60, headY: 8 }) },
  { name: "Dance", emoji: "🕺", pose: p({ armL: -160, armR: 20, legL: -30, legR: 0, bodyRot: -20, tilt: 6 }) },
  { name: "Look back", emoji: "👀", pose: p({ headY: 150, armL: 15, armR: -10 }) },
];

// ---------- interpolation (brickfilm feel) ----------

// Anticipation + overshoot, the "snappy" stop-motion feel of The LEGO Movie.
export function backInOut(x: number, s = 1.2): number {
  const c = s * 1.525;
  return x < 0.5
    ? (Math.pow(2 * x, 2) * ((c + 1) * 2 * x - c)) / 2
    : (Math.pow(2 * x - 2, 2) * ((c + 1) * (x * 2 - 2) + c) + 2) / 2;
}

export type AnimOptions = { stepped: boolean; fps: number; overshoot: number; hop: number };

export function evaluate(keys: Keyframe[], time: number, opt: AnimOptions): Pose {
  if (!keys.length) return NEUTRAL;
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const t = opt.stepped ? Math.floor(time * opt.fps + 1e-6) / opt.fps : time;
  if (t <= sorted[0].t) return sorted[0].pose;
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return last.pose;
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1].t < t) i++;
  const a = sorted[i];
  const b = sorted[i + 1];
  const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const e = opt.overshoot > 0 ? backInOut(u, opt.overshoot) : u * u * (3 - 2 * u);
  const out = {} as Pose;
  (Object.keys(NEUTRAL) as (keyof Pose)[]).forEach((k) => {
    out[k] = a.pose[k] + (b.pose[k] - a.pose[k]) * e;
  });
  // characters hop between poses like animated bricks
  out.bodyY += Math.sin(Math.PI * u) * opt.hop;
  return out;
}

// ---------- BrickLink parts ----------

export type Slot = "head" | "torso" | "arms" | "hands" | "hips" | "legs" | "hair" | "hat" | "face";

export const BL_COLORS: Record<string, string> = {
  white: "#f4f4f4", "very light gray": "#e6e3da", "light bluish gray": "#a0a5a9", "dark bluish gray": "#6c6e68",
  black: "#1b2a34", red: "#c91a09", "dark red": "#720e0f", orange: "#fe8a18", yellow: "#f2cd37",
  "bright light yellow": "#fff03a", tan: "#e4cd9e", "dark tan": "#958a73", "reddish brown": "#582a12",
  brown: "#583927", "dark brown": "#352100", green: "#237841", "bright green": "#4b9f4a", lime: "#bbe90b",
  "dark green": "#184632", "sand green": "#a0bcac", blue: "#0055bf", "dark blue": "#0a3463",
  "medium blue": "#5a93db", "dark azure": "#078bc9", "medium azure": "#36aebf", "sand blue": "#6074a1",
  "bright pink": "#e4adc8", "dark pink": "#c870a0", magenta: "#923978", "medium lavender": "#ac78ba",
  "dark purple": "#3f3691", "light nougat": "#f6d7b3", nougat: "#d09168", "medium nougat": "#aa7d55",
  "dark orange": "#a95500", "pearl gold": "#aa7f2e", "flat silver": "#898788", "trans-clear": "#fcfcfc",
};

export const BL_ID_COLORS: Record<string, string> = {
  "1": "white", "11": "black", "5": "red", "3": "yellow", "7": "blue", "6": "green", "86": "light bluish gray",
  "85": "dark bluish gray", "2": "tan", "88": "reddish brown", "63": "dark blue", "4": "orange", "59": "dark red",
};

const SLOT_RULES: [RegExp, Slot][] = [
  [/^(3626|28621)/, "head"],
  [/^(973|76382|88585)/, "torso"],
  [/^(981|982|3818|3819)/, "arms"],
  [/^(983|3820)/, "hands"],
  [/^(970|73200|3815|21019|16709|41879)/, "legs"],
  [/^(3901|6093|62696|40233|87990|21778|62810|92081|85974|59362|40251|23186|11256|3625)/, "hair"],
  [/^(3624|3629|3833|3878|30175|3842|30048|87610|2446|30608|4485|93219|61189|3844|86035)/, "hat"],
];

export type ParsedPart = { id: string; colorName: string; color: string; slot: Slot | null; raw: string };

export function parseParts(text: string): ParsedPart[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((raw) => {
      const clean = raw.replace(/^\d+\s*x\s+/i, "").replace(/\(.*?\)/g, "").trim();
      const [id, ...rest] = clean.split(/[\s,;]+/);
      let colorName = rest.join(" ").toLowerCase().trim();
      if (BL_ID_COLORS[colorName]) colorName = BL_ID_COLORS[colorName];
      const color = BL_COLORS[colorName] ?? "#f2cd37";
      const slot = SLOT_RULES.find(([re]) => re.test(id.toLowerCase()))?.[1] ?? null;
      return { id, colorName: colorName || "yellow", color, slot, raw };
    });
}

export type FigColors = {
  head: string; torso: string; arms: string; hands: string; hips: string; legs: string;
  hair: string | null; hat: string | null;
};

export function figureFromParts(parts: ParsedPart[]): FigColors {
  const f: FigColors = {
    head: BL_COLORS.yellow, torso: BL_COLORS.red, arms: BL_COLORS.red, hands: BL_COLORS.yellow,
    hips: BL_COLORS.blue, legs: BL_COLORS.blue, hair: null, hat: null,
  };
  let armsSet = false;
  for (const pt of parts) {
    switch (pt.slot) {
      case "head": f.head = pt.color; if (!parts.some((x) => x.slot === "hands")) f.hands = pt.color; break;
      case "torso": f.torso = pt.color; if (!armsSet) f.arms = pt.color; break;
      case "arms": f.arms = pt.color; armsSet = true; break;
      case "hands": f.hands = pt.color; break;
      case "legs": f.legs = pt.color; f.hips = pt.color; break;
      case "hair": f.hair = pt.color; break;
      case "hat": f.hat = pt.color; break;
    }
  }
  return f;
}

export const SAMPLE_PARTS = `# BrickLink part number + color (one per line)
3626cpb1 Yellow
973pb0101c01 Red
970c00 Blue
3901 Reddish Brown`;
