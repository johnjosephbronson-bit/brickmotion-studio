import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  evaluate, figureFromParts, JOINTS, NEUTRAL, parseParts, PRESETS, SAMPLE_PARTS,
  type AnimOptions, type Keyframe, type Pose,
} from "@/lib/minifig";

const MinifigScene = lazy(() => import("@/components/MinifigScene"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Brickmotion — Minifigure Animator" },
      { name: "description", content: "Animate a LEGO minifigure from BrickLink parts with poses, a timeline and video export." },
      { property: "og:title", content: "Brickmotion — Minifigure Animator" },
      { property: "og:description", content: "Pose and animate minifigures brickfilm-style, then export." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});

const uid = () => Math.random().toString(36).slice(2, 9);

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

function Studio() {
  const [partsText, setPartsText] = useState(SAMPLE_PARTS);
  const parts = useMemo(() => parseParts(partsText), [partsText]);
  const colors = useMemo(() => figureFromParts(parts), [parts]);

  const [keys, setKeys] = useState<Keyframe[]>([{ id: uid(), t: 0, label: "Neutral", pose: NEUTRAL }]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [transition, setTransition] = useState(0.6);
  const [opt, setOpt] = useState<AnimOptions>({ stepped: true, fps: 12, overshoot: 1.2, hop: 0.15 });
  const [recording, setRecording] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const sorted = useMemo(() => [...keys].sort((a, b) => a.t - b.t), [keys]);
  const endT = sorted[sorted.length - 1]?.t ?? 0;
  const duration = Math.max(endT + 0.5, 3);
  const pose = evaluate(keys, time, opt);
  const keyAtTime = sorted.find((k) => Math.abs(k.t - time) < 0.02);

  // playback
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => {
        const n = t + dt;
        if (n >= endT) {
          if (loop && !recording && endT > 0) return 0;
          setPlaying(false);
          return endT;
        }
        return n;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, endT, loop, recording]);

  const jumpTo = (name: string, target: Pose) => {
    const start = Math.max(time, keyAtTime ? time : 0);
    const current = evaluate(keys, start, { ...opt, stepped: false, hop: 0 });
    const t = +(start + transition).toFixed(3);
    setKeys((ks) => {
      const kept = ks.filter((k) => k.t <= start + 0.001);
      if (!kept.some((k) => Math.abs(k.t - start) < 0.02))
        kept.push({ id: uid(), t: start, label: "Hold", pose: current });
      return [...kept, { id: uid(), t, label: name, pose: target }];
    });
    setTime(start);
    setPlaying(true);
  };

  const editJoint = (key: keyof Pose, value: number) => {
    setPlaying(false);
    setKeys((ks) => {
      const hit = ks.find((k) => Math.abs(k.t - time) < 0.02);
      if (hit) return ks.map((k) => (k === hit ? { ...k, pose: { ...k.pose, [key]: value } } : k));
      const base = evaluate(ks, time, { ...opt, stepped: false, hop: 0 });
      return [...ks, { id: uid(), t: +time.toFixed(3), label: "Custom", pose: { ...base, [key]: value } }];
    });
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ parts: partsText, options: opt, keyframes: sorted }, null, 2)], { type: "application/json" });
    download(URL.createObjectURL(blob), "minifig-animation.json");
  };
  const importJSON = async (f: File) => {
    const data = JSON.parse(await f.text());
    if (data.parts) setPartsText(data.parts);
    if (data.options) setOpt(data.options);
    if (Array.isArray(data.keyframes)) setKeys(data.keyframes);
    setTime(0);
  };
  const exportPNG = () => {
    if (canvasRef.current) download(canvasRef.current.toDataURL("image/png"), "minifig-frame.png");
  };
  const exportVideo = () => {
    const c = canvasRef.current;
    if (!c || endT <= 0) return;
    const stream = c.captureStream(30);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      download(URL.createObjectURL(new Blob(chunks, { type: "video/webm" })), "minifig-animation.webm");
      setRecording(false);
    };
    setRecording(true);
    setTime(0);
    rec.start();
    setPlaying(true);
    setTimeout(() => rec.stop(), (endT + 0.4) * 1000);
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="stud-logo" />
          <h1 className="font-display text-lg font-bold tracking-tight">Brickmotion</h1>
          <span className="text-xs text-muted-foreground">Minifigure animator</span>
        </div>
        <div className="flex gap-2">
          <label className="btn-ghost cursor-pointer">
            Import
            <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importJSON(e.target.files[0])} />
          </label>
          <button className="btn-ghost" onClick={exportJSON}>Export JSON</button>
          <button className="btn-ghost" onClick={exportPNG}>Export PNG</button>
          <button className="btn-primary" onClick={exportVideo} disabled={recording || endT <= 0}>
            {recording ? "Recording…" : "Export video"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* left: parts + poses */}
        <aside className="panel w-72">
          <section>
            <h2 className="panel-title">BrickLink parts</h2>
            <textarea
              className="field h-32 font-mono text-xs"
              value={partsText}
              onChange={(e) => setPartsText(e.target.value)}
              spellCheck={false}
            />
            <ul className="mt-2 space-y-1">
              {parts.map((pt, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span className="swatch" style={{ background: pt.color }} />
                  <span className="font-mono">{pt.id}</span>
                  <span className="ml-auto text-muted-foreground">{pt.slot ?? "unknown"}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="panel-title">Jump to pose</h2>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((pr) => (
                <button key={pr.name} className="pose-tile" onClick={() => jumpTo(pr.name, pr.pose)}>
                  <span className="text-xl">{pr.emoji}</span>
                  <span>{pr.name}</span>
                </button>
              ))}
            </div>
            <label className="mt-3 block text-xs text-muted-foreground">
              Transition: {transition.toFixed(2)}s
              <input type="range" min={0.2} max={2} step={0.05} value={transition} onChange={(e) => setTransition(+e.target.value)} className="slider" />
            </label>
          </section>
        </aside>

        {/* viewport */}
        <main className="relative min-w-0 flex-1">
          <ClientOnly fallback={<div className="grid h-full place-items-center text-muted-foreground">Loading 3D…</div>}>
            <Suspense fallback={null}>
              <MinifigScene pose={pose} colors={colors} ground="#f3efe6" onCanvas={(c) => (canvasRef.current = c)} />
            </Suspense>
          </ClientOnly>
          <div className="absolute left-4 top-4 rounded-full bg-card/90 px-3 py-1 text-xs text-muted-foreground shadow-sm">
            {opt.stepped ? `Brickfilm ${opt.fps} fps` : "Smooth"} · drag to orbit
          </div>
        </main>

        {/* right: poser */}
        <aside className="panel w-72">
          <section>
            <h2 className="panel-title">
              Poser <span className="font-normal text-muted-foreground">{keyAtTime ? `editing “${keyAtTime.label}”` : "adds a key"}</span>
            </h2>
            {JOINTS.map((j) => (
              <label key={j.key} className="mb-2 block text-xs">
                <span className="flex justify-between"><span>{j.label}</span><span className="font-mono text-muted-foreground">{pose[j.key].toFixed(j.step < 1 ? 2 : 0)}</span></span>
                <input type="range" className="slider" min={j.min} max={j.max} step={j.step} value={pose[j.key]} onChange={(e) => editJoint(j.key, +e.target.value)} />
              </label>
            ))}
          </section>
          <section>
            <h2 className="panel-title">Motion style</h2>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={opt.stepped} onChange={(e) => setOpt({ ...opt, stepped: e.target.checked })} />
              Stop-motion stepping
            </label>
            <label className="mt-2 block text-xs">Frame rate: {opt.fps} fps
              <input type="range" className="slider" min={6} max={24} step={1} value={opt.fps} onChange={(e) => setOpt({ ...opt, fps: +e.target.value })} />
            </label>
            <label className="block text-xs">Snap / overshoot: {opt.overshoot.toFixed(1)}
              <input type="range" className="slider" min={0} max={2.5} step={0.1} value={opt.overshoot} onChange={(e) => setOpt({ ...opt, overshoot: +e.target.value })} />
            </label>
            <label className="block text-xs">Hop between poses: {opt.hop.toFixed(2)}
              <input type="range" className="slider" min={0} max={0.8} step={0.05} value={opt.hop} onChange={(e) => setOpt({ ...opt, hop: +e.target.value })} />
            </label>
          </section>
        </aside>
      </div>

      {/* timeline */}
      <footer className="border-t border-border bg-card px-5 py-3">
        <div className="mb-2 flex items-center gap-2">
          <button className="btn-primary w-20" onClick={() => { if (time >= endT) setTime(0); setPlaying(!playing); }}>
            {playing ? "Pause" : "Play"}
          </button>
          <button className="btn-ghost" onClick={() => { setPlaying(false); setTime(0); }}>⏮</button>
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop</label>
          <span className="ml-2 font-mono text-xs text-muted-foreground">{time.toFixed(2)}s / {endT.toFixed(2)}s</span>
          <button className="btn-ghost ml-auto" disabled={!keyAtTime || keys.length < 2} onClick={() => keyAtTime && setKeys(keys.filter((k) => k.id !== keyAtTime.id))}>Delete key</button>
          <button className="btn-ghost" onClick={() => { setKeys([{ id: uid(), t: 0, label: "Neutral", pose: NEUTRAL }]); setTime(0); setPlaying(false); }}>Clear</button>
        </div>
        <div className="timeline">
          {sorted.map((k) => (
            <button
              key={k.id}
              title={`${k.label} @ ${k.t.toFixed(2)}s`}
              className={`key ${keyAtTime?.id === k.id ? "key-active" : ""}`}
              style={{ left: `${(k.t / duration) * 100}%` }}
              onClick={() => { setPlaying(false); setTime(k.t); }}
            >
              <span className="key-label">{k.label}</span>
            </button>
          ))}
          <div className="playhead" style={{ left: `${(time / duration) * 100}%` }} />
          <input
            type="range" min={0} max={duration} step={0.01} value={time}
            className="scrub"
            onChange={(e) => { setPlaying(false); setTime(+e.target.value); }}
          />
        </div>
      </footer>
    </div>
  );
}
