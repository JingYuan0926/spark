import { useRef, useEffect, useState, useCallback } from "react";

/* ── Category mapping ──────────────────────────────────── */
const CATEGORIES: Record<string, { color: number[]; topicId: string; label: string }> = {
  scam:       { color: [166, 28, 60],   topicId: "0.0.7993401", label: "Scam" },
  blockchain: { color: [105, 74, 56],   topicId: "0.0.7993402", label: "Blockchain" },
  legal:      { color: [244, 172, 69],  topicId: "0.0.7993403", label: "Legal" },
  trend:      { color: [208, 241, 191], topicId: "0.0.7993404", label: "Trend" },
  skills:     { color: [75, 127, 82],   topicId: "0.0.7993405", label: "Skills" },
};

/* ── Globe block colors (3 shades × 5 categories) ──────── */
const GLOBE_COLORS = [
  [55, 95, 60], [75, 127, 82], [110, 160, 115],
  [160, 210, 148], [208, 241, 191], [225, 248, 215],
  [200, 135, 30], [244, 172, 69], [250, 200, 120],
  [75, 50, 35], [105, 74, 56], [145, 110, 90],
  [120, 15, 40], [166, 28, 60], [200, 70, 95],
];

/* ── Mock knowledge ────────────────────────────────────── */
interface Knowledge {
  id: number;
  title: string;
  description: string;
  category: string;
  upvotes: number;
  downvotes: number;
  quorum: number;
}

const MOCK_KNOWLEDGE: Knowledge[] = [
  {
    id: 1,
    title: "Rug Pull Pattern Detection",
    description:
      "Identified common smart contract patterns associated with rug pulls on EVM chains. The analysis covers token approval exploits, hidden mint functions, and liquidity removal patterns used in over 200 documented scam projects.",
    category: "scam",
    upvotes: 4, downvotes: 0, quorum: 4.0,
  },
  {
    id: 2,
    title: "Hedera Token Service Gas Optimization",
    description:
      "Research on optimizing HTS token operations to reduce gas costs by up to 40%. Covers batch token associations, scheduled transactions, and efficient use of the Hedera SDK for high-throughput token operations.",
    category: "blockchain",
    upvotes: 5, downvotes: 0, quorum: 5.5,
  },
  {
    id: 3,
    title: "DeFi Regulatory Framework Analysis",
    description:
      "Comprehensive analysis of emerging DeFi regulations across jurisdictions including EU MiCA, US SEC guidelines, and Singapore MAS frameworks. Includes compliance checklist for autonomous agents operating in regulated markets.",
    category: "legal",
    upvotes: 3, downvotes: 1, quorum: 3.5,
  },
  {
    id: 4,
    title: "AI Agent Market Trend Q1 2026",
    description:
      "Analysis of autonomous AI agent adoption trends in DeFi for Q1 2026. Covers market size growth, protocol integration rates, and emerging use cases in yield optimization, MEV protection, and cross-chain arbitrage.",
    category: "trend",
    upvotes: 6, downvotes: 1, quorum: 5.5,
  },
  {
    id: 5,
    title: "Multi-Chain Data Scraping Framework",
    description:
      "A reusable framework for scraping on-chain data across Hedera, Ethereum, and 0G Chain simultaneously. Includes rate limiting, error recovery, and data normalization patterns for autonomous agent consumption.",
    category: "skills",
    upvotes: 4, downvotes: 1, quorum: 4.5,
  },
];

/* ── Types ─────────────────────────────────────────────── */
interface Block {
  lat: number;
  lng: number;
  color: number[];
  opacity: number;
}

interface LightRay {
  targetLat: number;
  targetLng: number;
  progress: number;
  color: number[];
  age: number;
}

/* ── Helpers ───────────────────────────────────────────── */
function generateBlocks(): Block[] {
  const blocks: Block[] = [];
  const latSteps = 50;
  const lngSteps = 100;

  for (let i = 0; i < latSteps; i++) {
    const lat = (i / (latSteps - 1)) * Math.PI - Math.PI / 2;
    const ringCount = Math.round(Math.cos(lat) * lngSteps);
    for (let j = 0; j < ringCount; j++) {
      const lng = (j / ringCount) * Math.PI * 2;
      const shade = GLOBE_COLORS[Math.floor(Math.random() * GLOBE_COLORS.length)];
      const rand = Math.random();
      let opacity = 1;
      if (rand < 0.15) opacity = 0.3;
      else if (rand < 0.35) opacity = 0.5;
      else if (rand < 0.6) opacity = 0.7;
      else if (rand < 0.85) opacity = 0.85;
      blocks.push({ lat, lng, color: shade, opacity });
    }
  }
  return blocks;
}

/* ── Preview Globe (small, card view) ──────────────────── */
function KnowledgeGlobe({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blocksRef = useRef<Block[]>(generateBlocks());
  const angleRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const radius = Math.min(width, height) * 0.48;
    const cx = width / 2;
    const cy = height / 2;
    const blockSize = Math.max(2, radius * 0.038);

    let animId: number;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const rot = angleRef.current;
      const sorted = blocksRef.current
        .map((b) => {
          const cosLat = Math.cos(b.lat);
          return { ...b, x: cosLat * Math.sin(b.lng + rot), y: Math.sin(b.lat), z: cosLat * Math.cos(b.lng + rot) };
        })
        .filter((b) => b.z > -0.2)
        .sort((a, b) => a.z - b.z);

      for (const b of sorted) {
        const sx = cx + b.x * radius;
        const sy = cy - b.y * radius;
        const depth = (b.z + 1) / 2;
        const scale = 0.5 + depth * 0.5;
        const size = blockSize * scale;
        const alpha = b.opacity * (0.3 + depth * 0.7);
        ctx.fillStyle = `rgba(${b.color[0]},${b.color[1]},${b.color[2]},${alpha})`;
        ctx.beginPath();
        ctx.roundRect(sx - size / 2, sy - size / 2, size, size, 1.5);
        ctx.fill();
      }

      angleRef.current += 0.004;
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animId);
  }, [width, height]);

  return <canvas ref={canvasRef} style={{ width, height }} />;
}

/* ── Modal Globe (interactive — rays, glow, hover) ─────── */
function ModalGlobe({
  width,
  height,
  onHoverKnowledge,
  onClickKnowledge,
}: {
  width: number;
  height: number;
  onHoverKnowledge: (k: Knowledge | null) => void;
  onClickKnowledge: (k: Knowledge | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blocksRef = useRef<Block[]>(generateBlocks());
  const angleRef = useRef(0);
  const mouseRef = useRef({ x: -1, y: -1 });
  const isHoveringGlobeRef = useRef(false);
  const raysRef = useRef<LightRay[]>([]);
  const lastRayTimeRef = useRef(0);
  const lastHoveredKeyRef = useRef("");
  const nearestScreenRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (width <= 0 || height <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const radius = Math.min(width, height) * 0.46;
    const cx = width / 2;
    const cy = height / 2;
    const blockSize = Math.max(2, radius * 0.035);
    const GLOW_RADIUS = 35;
    const GLOW_RADIUS_SQ = GLOW_RADIUS * GLOW_RADIUS;

    let animId: number;

    const draw = (timestamp: number) => {
      ctx.clearRect(0, 0, width, height);
      const rot = angleRef.current;
      const mouse = mouseRef.current;

      // Is mouse inside globe circle?
      const gdx = mouse.x - cx;
      const gdy = mouse.y - cy;
      isHoveringGlobeRef.current = gdx * gdx + gdy * gdy < radius * radius;
      const isOverGlobe = isHoveringGlobeRef.current;

      // ── Spawn light rays ──
      if (timestamp - lastRayTimeRef.current > 1200) {
        lastRayTimeRef.current = timestamp;
        const catKeys = Object.keys(CATEGORIES);
        const cat = catKeys[Math.floor(Math.random() * catKeys.length)];
        raysRef.current.push({
          targetLat: (Math.random() - 0.5) * Math.PI * 0.8,
          targetLng: Math.random() * Math.PI * 2,
          progress: 0,
          color: CATEGORIES[cat].color,
          age: 0,
        });
      }
      raysRef.current = raysRef.current
        .map((r) => ({ ...r, progress: Math.min(1, r.progress + 0.025), age: r.age + 1 }))
        .filter((r) => r.age < 90);

      // ── Project & sort blocks ──
      const sorted = blocksRef.current
        .map((b) => {
          const cosLat = Math.cos(b.lat);
          return { ...b, x: cosLat * Math.sin(b.lng + rot), y: Math.sin(b.lat), z: cosLat * Math.cos(b.lng + rot) };
        })
        .filter((b) => b.z > -0.2)
        .sort((a, b) => a.z - b.z);

      // ── Draw blocks with glow ──
      let nearestDistSq = 20 * 20;
      let nearestKey = "";
      let nearestSX = 0;
      let nearestSY = 0;

      for (const b of sorted) {
        const sx = cx + b.x * radius;
        const sy = cy - b.y * radius;
        const depth = (b.z + 1) / 2;
        const scale = 0.5 + depth * 0.5;
        const size = blockSize * scale;
        const alpha = b.opacity * (0.3 + depth * 0.7);

        // Distance from mouse
        const dx = mouse.x - sx;
        const dy = mouse.y - sy;
        const distSq = dx * dx + dy * dy;
        const isGlowing = isOverGlobe && distSq < GLOW_RADIUS_SQ;

        if (isGlowing) {
          const intensity = 1 - Math.sqrt(distSq) / GLOW_RADIUS;
          ctx.save();
          ctx.shadowColor = `rgba(${b.color[0]},${b.color[1]},${b.color[2]},${0.9 * intensity})`;
          ctx.shadowBlur = 14 * intensity;
          const boostedAlpha = Math.min(1, alpha + 0.4 * intensity);
          ctx.fillStyle = `rgba(${b.color[0]},${b.color[1]},${b.color[2]},${boostedAlpha})`;
          const glowSize = size * (1 + 0.4 * intensity);
          ctx.beginPath();
          ctx.roundRect(sx - glowSize / 2, sy - glowSize / 2, glowSize, glowSize, 1.5);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = `rgba(${b.color[0]},${b.color[1]},${b.color[2]},${alpha})`;
          ctx.beginPath();
          ctx.roundRect(sx - size / 2, sy - size / 2, size, size, 1.5);
          ctx.fill();
        }

        // Track nearest block to mouse
        if (isOverGlobe && distSq < nearestDistSq) {
          nearestDistSq = distSq;
          nearestKey = `${b.lat.toFixed(2)},${b.lng.toFixed(2)}`;
          nearestSX = sx;
          nearestSY = sy;
        }
      }

      // ── Report hover knowledge ──
      if (nearestKey && nearestKey !== lastHoveredKeyRef.current) {
        lastHoveredKeyRef.current = nearestKey;
        nearestScreenRef.current = { x: nearestSX, y: nearestSY };
        const randomK = MOCK_KNOWLEDGE[Math.floor(Math.random() * MOCK_KNOWLEDGE.length)];
        onHoverKnowledge(randomK);
      } else if (!nearestKey && lastHoveredKeyRef.current) {
        lastHoveredKeyRef.current = "";
        nearestScreenRef.current = null;
        onHoverKnowledge(null);
      }

      // ── Draw light rays ──
      for (const ray of raysRef.current) {
        const cosLat = Math.cos(ray.targetLat);
        const tx = cosLat * Math.sin(ray.targetLng + rot);
        const ty = Math.sin(ray.targetLat);
        const tz = cosLat * Math.cos(ray.targetLng + rot);

        if (tz > 0) {
          const targetSX = cx + tx * radius;
          const targetSY = cy - ty * radius;
          const dirX = tx;
          const dirY = -ty;
          const len = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
          const startSX = targetSX + (dirX / len) * radius * 0.9;
          const startSY = targetSY + (dirY / len) * radius * 0.9;

          const curX = startSX + (targetSX - startSX) * ray.progress;
          const curY = startSY + (targetSY - startSY) * ray.progress;
          const trailP = Math.max(0, ray.progress - 0.4);
          const trailX = startSX + (targetSX - startSX) * trailP;
          const trailY = startSY + (targetSY - startSY) * trailP;

          const rayAlpha = ray.progress < 1 ? 0.7 : Math.max(0, 0.7 - (ray.age - 40) * 0.015);
          if (rayAlpha > 0) {
            ctx.strokeStyle = `rgba(${ray.color[0]},${ray.color[1]},${ray.color[2]},${rayAlpha})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(trailX, trailY);
            ctx.lineTo(curX, curY);
            ctx.stroke();
          }

          if (ray.progress >= 1) {
            const flashAlpha = Math.max(0, 0.6 - (ray.age - 40) * 0.015);
            if (flashAlpha > 0) {
              ctx.fillStyle = `rgba(${ray.color[0]},${ray.color[1]},${ray.color[2]},${flashAlpha})`;
              ctx.beginPath();
              ctx.arc(targetSX, targetSY, 5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      // Rotate only when NOT hovering
      if (!isHoveringGlobeRef.current) {
        angleRef.current += 0.004;
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [width, height, onHoverKnowledge]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [],
  );

  const handleMouseLeave = useCallback(() => {
    mouseRef.current = { x: -1, y: -1 };
    isHoveringGlobeRef.current = false;
    lastHoveredKeyRef.current = "";
    onHoverKnowledge(null);
  }, [onHoverKnowledge]);

  const handleClick = useCallback(
    () => {
      // If hovering a block, pin the current random knowledge as selected
      if (lastHoveredKeyRef.current) {
        const randomK = MOCK_KNOWLEDGE[Math.floor(Math.random() * MOCK_KNOWLEDGE.length)];
        onClickKnowledge(randomK);
      } else {
        onClickKnowledge(null);
      }
    },
    [onClickKnowledge],
  );

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    />
  );
}

/* ── Knowledge Detail Panel ────────────────────────────── */
function KnowledgeDetail({ knowledge, isPreview }: { knowledge: Knowledge; isPreview?: boolean }) {
  const cat = CATEGORIES[knowledge.category];
  const isVerified = knowledge.quorum >= 5.5;

  return (
    <div className={`rounded-xl p-5 ${isPreview ? "bg-white/5" : "bg-white/10"}`}>
      <div className="flex items-start gap-2">
        <h4 className={`font-bold text-white ${isPreview ? "text-base" : "text-lg"}`}>
          {knowledge.title}
        </h4>
        {isVerified && (
          <span className="mt-0.5 shrink-0 text-[#4B7F52]" title="Verified — Quorum Met">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </span>
        )}
      </div>

      <div className="mt-1 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: `rgb(${cat.color.join(",")})` }}
        />
        <span className="text-xs text-white/50">
          {cat.label} · {cat.topicId}
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-white/70">{knowledge.description}</p>

      <div className="mt-4 flex flex-wrap items-center gap-5 text-sm">
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4B7F52" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          <span className="font-bold text-[#4B7F52]">{knowledge.upvotes}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DD6E42" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
          <span className="font-bold text-[#DD6E42]">{knowledge.downvotes}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-white/40">Quorum</span>
          <span className={`font-bold ${isVerified ? "text-[#4B7F52]" : "text-white/70"}`}>
            {knowledge.quorum} / 5.5
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Knowledge Modal ───────────────────────────────────── */
function KnowledgeModal({ onClose }: { onClose: () => void }) {
  const [hoveredKnowledge, setHoveredKnowledge] = useState<Knowledge | null>(null);
  const [selectedKnowledge, setSelectedKnowledge] = useState<Knowledge | null>(null);
  const globeContainerRef = useRef<HTMLDivElement>(null);
  const [globeSize, setGlobeSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = globeContainerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setGlobeSize({ w: width, h: height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const displayKnowledge = selectedKnowledge || hoveredKnowledge;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex h-[80vh] w-[85vw] max-w-[1400px] overflow-hidden rounded-2xl bg-[#2d3f47]/90 backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 text-white/50 transition hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Left — Globe (30%) */}
        <div
          ref={globeContainerRef}
          className="flex w-[30%] shrink-0 items-center justify-center border-r border-white/10 p-4"
        >
          {globeSize && globeSize.w > 0 && globeSize.h > 0 && (
            <ModalGlobe
              width={globeSize.w - 32}
              height={globeSize.h - 32}
              onHoverKnowledge={setHoveredKnowledge}
              onClickKnowledge={setSelectedKnowledge}
            />
          )}
        </div>

        {/* Right — Content (70%) */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
          <div>
            <h3 className="text-lg font-bold text-white">Knowledge Layer</h3>
            <p className="mt-1 text-xs text-white/50">
              Hover over the globe to preview · Click to pin details
            </p>
          </div>

          {/* Legend + Stats row */}
          <div className="flex gap-8">
            {/* Legend */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-white/40">
                Categories
              </h4>
              <div className="mt-2 space-y-1.5">
                {Object.entries(CATEGORIES).map(([key, { color, topicId, label }]) => (
                  <div key={key} className="flex items-center gap-2.5 text-sm">
                    <span
                      className="h-3 w-3 rounded-sm"
                      style={{ backgroundColor: `rgb(${color.join(",")})` }}
                    />
                    <span className="font-medium text-white/80">{label}</span>
                    <span className="font-mono text-xs text-white/30">{topicId}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div className="flex gap-6">
              <div>
                <p className="text-xs text-white/40">Submitted</p>
                <p className="text-lg font-bold text-white">80,120</p>
              </div>
              <div>
                <p className="text-xs text-white/40">Approved</p>
                <p className="text-lg font-bold text-white">50,235</p>
              </div>
              <div>
                <p className="text-xs text-white/40">Retrieved</p>
                <p className="text-lg font-bold text-white">123,482</p>
              </div>
            </div>
          </div>

          {/* Knowledge detail area */}
          <div className="flex-1">
            {selectedKnowledge && (
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-white/40">
                  Pinned Knowledge
                </span>
                <button
                  onClick={() => setSelectedKnowledge(null)}
                  className="text-xs text-white/30 transition hover:text-white/60"
                >
                  Clear
                </button>
              </div>
            )}
            {displayKnowledge ? (
              <KnowledgeDetail
                knowledge={displayKnowledge}
                isPreview={!selectedKnowledge}
              />
            ) : (
              <div className="flex h-32 items-center justify-center text-sm text-white/30">
                Hover over the globe to explore knowledge
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main Export ────────────────────────────────────────── */
export function KnowledgeLayer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: width, h: height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <div
        ref={containerRef}
        className="relative flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-[#4F6D7A]/50 p-4 transition hover:bg-[#4F6D7A]/60"
        onClick={() => setShowModal(true)}
      >
        {/* Expand icon — top right */}
        <button
          className="absolute top-3 right-3 z-10 text-[#2d3f47]/40 transition hover:text-[#2d3f47]"
          onClick={(e) => {
            e.stopPropagation();
            setShowModal(true);
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          </svg>
        </button>

        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#2d3f47]">
          Knowledge Layer
        </h2>
        <div className="flex flex-1 items-center justify-center">
          {size && <KnowledgeGlobe width={size.w - 24} height={size.h - 90} />}
        </div>
        <div className="flex justify-between text-center">
          <div>
            <p className="text-xs text-[#2d3f47]/50">Submitted</p>
            <p className="text-lg font-bold text-[#2d3f47]">80,120</p>
          </div>
          <div>
            <p className="text-xs text-[#2d3f47]/50">Approved</p>
            <p className="text-lg font-bold text-[#2d3f47]">50,235</p>
          </div>
          <div>
            <p className="text-xs text-[#2d3f47]/50">Retrieved</p>
            <p className="text-lg font-bold text-[#2d3f47]">123,482</p>
          </div>
        </div>
      </div>

      {showModal && <KnowledgeModal onClose={() => setShowModal(false)} />}
    </>
  );
}
