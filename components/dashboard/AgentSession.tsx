import { useRef, useEffect, useCallback, useState } from "react";
import { useAgent } from "@/components/AgentContext";

// ── Colors ──────────────────────────────────────────────────────
const C = {
  walnut: [72, 53, 25] as const,
  peach: [221, 110, 66] as const,
  slate: [79, 109, 122] as const,
  fern: [75, 127, 82] as const,
};

function rgba(c: readonly number[], a: number) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

// ── Stage → Animation mapping ───────────────────────────────────
type AgentStage = "researching" | "retrieving" | "resting";

const STAGE_CONFIG: Record<AgentStage, {
  label: string;
  target: { x: number; y: number };
  color: readonly number[];
}> = {
  researching: { label: "Researching...", target: { x: 0.18, y: 0.18 }, color: C.slate },
  retrieving: { label: "Retrieving from Knowledge Layer...", target: { x: 0.78, y: 0.15 }, color: C.fern },
  resting: { label: "Touching grass...", target: { x: 0.15, y: 0.75 }, color: C.peach },
};

// ── Canvas drawing ──────────────────────────────────────────────

function drawAgent(
  ctx: CanvasRenderingContext2D,
  px: number, py: number,
  unit: number, timestamp: number,
  isMoving: boolean, facingRight: boolean,
) {
  const bw = unit * 0.045;
  const bh = unit * 0.06;
  const bob = isMoving ? 0 : Math.sin(timestamp * 0.003) * 2;
  const legSwing = isMoving ? Math.sin(timestamp * 0.012) * 3 : 0;
  const x = px, y = py + bob;

  ctx.fillStyle = rgba([0, 0, 0], 0.12);
  ctx.beginPath();
  ctx.ellipse(px, py + bh / 2 + 4, bw * 0.7, bw * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  const legW = bw * 0.32, legH = bh * 0.18;
  ctx.fillStyle = rgba(C.fern, 0.85);
  ctx.beginPath();
  ctx.roundRect(x - bw * 0.35, y + bh / 2 - legH * 0.3 + legSwing, legW, legH, 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x + bw * 0.05, y + bh / 2 - legH * 0.3 - legSwing, legW, legH, 2);
  ctx.fill();

  const bpSide = facingRight ? -1 : 1;
  ctx.fillStyle = rgba(C.fern, 0.65);
  ctx.beginPath();
  ctx.roundRect(x + bpSide * bw * 0.38, y - bh * 0.05, bw * 0.2, bh * 0.35, 3);
  ctx.fill();

  ctx.fillStyle = rgba(C.fern, 0.85);
  ctx.beginPath();
  ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, bw / 2);
  ctx.fill();

  const vs = facingRight ? 1 : -1;
  ctx.fillStyle = rgba(C.slate, 0.8);
  ctx.beginPath();
  ctx.roundRect(x + vs * bw * 0.08, y - bh * 0.25, bw * 0.38, bh * 0.25, [4, 4, 2, 2]);
  ctx.fill();

  ctx.fillStyle = rgba([255, 255, 255], 0.25);
  ctx.beginPath();
  ctx.roundRect(x + vs * bw * 0.15, y - bh * 0.22, bw * 0.12, bh * 0.08, 2);
  ctx.fill();
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  px: number, py: number,
  label: string, color: readonly number[],
  unit: number,
) {
  const fontSize = Math.max(9, unit * 0.024);
  ctx.font = `600 ${fontSize}px sans-serif`;
  const textW = ctx.measureText(label).width;
  const padX = fontSize * 0.7, padY = fontSize * 0.5;
  const bubW = textW + padX * 2, bubH = fontSize + padY * 2;
  const bx = px - bubW / 2;
  const by = py - unit * 0.06 / 2 - bubH - 10;

  ctx.fillStyle = rgba(color, 0.85);
  ctx.beginPath();
  ctx.roundRect(bx, by, bubW, bubH, 6);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(px - 5, by + bubH);
  ctx.lineTo(px, by + bubH + 6);
  ctx.lineTo(px + 5, by + bubH);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = rgba([255, 255, 255], 0.95);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, px, by + bubH / 2);
}

// ── Activity entry (from HEAD — ledger-based) ───────────────────
interface ActivityEntry {
  id: string;
  type: string;
  bot: string;
  time: string;
  detail: string;
}

function timeAgo(consensusTimestamp: string): string {
  const secs = parseFloat(consensusTimestamp);
  const date = new Date(secs * 1000);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function parseActivity(msg: Record<string, unknown>, seqNo: number): ActivityEntry {
  const type = (msg.type as string) || "unknown";
  const bot = (msg.botId as string) || (msg.bot_id as string) || "unknown";
  const time = msg._consensusAt ? timeAgo(msg._consensusAt as string) : "";
  let detail = "";

  if (type === "agent_registered") {
    const evmAddr = (msg.evmAddress as string) || "";
    detail = `EVM: ${evmAddr ? evmAddr.slice(0, 20) + "..." : "—"}`;
  } else if (type === "knowledge_submitted") {
    const cat = (msg.category as string) || "";
    const hash = (msg.dataHash as string) || (msg.data_hash as string) || "";
    detail = `Topic: ${cat} | Hash: ${hash ? hash.slice(0, 20) + "..." : "—"}`;
  } else if (type === "vote_cast") {
    const vote = (msg.vote as string) || "";
    const target = (msg.targetBot as string) || (msg.target_bot as string) || "";
    detail = `${vote} on ${target}`;
  } else {
    detail = JSON.stringify(msg).slice(0, 60);
  }

  return { id: `#${seqNo}`, type, bot, time, detail };
}

const FALLBACK_ACTIVITY: ActivityEntry[] = [
  { id: "#—", type: "info", bot: "system", time: "", detail: "Loading master topic logs..." },
];

const TYPE_COLORS: Record<string, string> = {
  agent_registered: "text-[#4B7F52]",
  knowledge_submitted: "text-[#4F6D7A]",
  vote_cast: "text-[#DD6E42]",
  info: "text-[#483519]/50",
};

// ── Chat message type (from incoming — LLM cycle) ───────────────
interface ChatMsg {
  role: "agent" | "system";
  content: string;
  stage?: AgentStage;
  timestamp: number;
}

// ── Main Component ──────────────────────────────────────────────

export function AgentSession() {
  const { agent } = useAgent();
  const evmAddress = agent?.evmAddress || "";

  // Canvas refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const bgRef = useRef<HTMLImageElement | null>(null);

  // LLM state
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [currentStage, setCurrentStage] = useState<AgentStage>("researching");
  const [running, setRunning] = useState(false);
  const conversationRef = useRef<{ role: string; content: string }[]>([]);

  // Deterministic stage progression — frontend drives, not LLM
  const STAGE_SEQUENCE: AgentStage[] = ["retrieving", "researching", "resting"];
  const cycleRef = useRef(0);

  // Subscription state

  // Activity log (ledger-based from HEAD)
  const [activity, setActivity] = useState<ActivityEntry[]>(FALLBACK_ACTIVITY);
  const [masterTopicId, setMasterTopicId] = useState<string | null>(null);

  // Fetch ledger for platform activity (from HEAD)
  useEffect(() => {
    let cancelled = false;
    async function fetchLedger() {
      try {
        const res = await fetch("/api/spark/ledger");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.success) return;
        setMasterTopicId(data.masterTopicId || null);
        const msgs: Record<string, unknown>[] = data.ledger?.master?.messages || [];
        if (msgs.length === 0) return;
        const parsed = msgs
          .map((m) => parseActivity(m, (m._seqNo as number) || 0))
          .reverse();
        setActivity(parsed);
      } catch {
        // keep fallback
      }
    }
    fetchLedger();
    return () => { cancelled = true; };
  }, []);

  // Animation ref — driven by currentStage
  const animRef = useRef({
    agentX: 0.80, agentY: 0.78,
    targetX: 0.80, targetY: 0.78,
    currentLabel: "Subscribing to gated knowledge...",
    currentColor: C.walnut as readonly number[],
    initialized: false, facingRight: true,
  });

  // Keep animation target in sync with currentStage
  useEffect(() => {
    const config = STAGE_CONFIG[currentStage];
    const a = animRef.current;
    a.targetX = config.target.x;
    a.targetY = config.target.y;
    a.currentLabel = config.label;
    a.currentColor = config.color;
  }, [currentStage]);



  // ── Fetch knowledge context ─────────────────────────────────
  const fetchKnowledge = useCallback(async (): Promise<string> => {
    try {
      const res = await fetch("/api/spark/pending-knowledge");
      const data = await res.json();
      if (!data.success) return "";
      const items = [...(data.approved || []), ...(data.pending || [])];
      if (items.length === 0) return "No knowledge items found in the registry.";
      const sample = items.slice(0, 3).map(
        (i: { category: string; content: string; status: string }) =>
          `[${i.category}] ${i.content?.slice(0, 120) || "(no content)"}  (${i.status})`
      ).join("\n");
      return `Found ${items.length} knowledge items:\n${sample}`;
    } catch {
      return "";
    }
  }, []);

  // ── LLM chat cycle (deterministic stage progression) ──────
  const runCycle = useCallback(async () => {
    const stage = STAGE_SEQUENCE[cycleRef.current % STAGE_SEQUENCE.length];
    setCurrentStage(stage);

    let knowledgeContext: string | undefined;

    if (stage === "retrieving") {
      knowledgeContext = await fetchKnowledge();
    }

    try {
      const res = await fetch("/api/spark/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationHistory: conversationRef.current.slice(-10),
          currentStage: stage,
          knowledgeContext,
        }),
      });
      const data = await res.json();
      if (!data.success) return;

      conversationRef.current.push(
        { role: "user", content: `[Stage: ${stage}]` },
        { role: "assistant", content: data.response },
      );

      setMessages((prev) => [...prev, {
        role: "agent",
        content: data.response,
        stage,
        timestamp: Date.now(),
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: "system",
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      }]);
    }

    cycleRef.current += 1;
  }, [fetchKnowledge]);

  // ── Main loop: run every 15s ────────────────────────────────
  useEffect(() => {
    if (!agent || running) return;
    setRunning(true);

    setMessages([{
      role: "system",
      content: "Agent session started. Beginning autonomous research cycle...",
      timestamp: Date.now(),
    }]);

    let mounted = true;
    const firstRun = async () => {
      if (mounted) await runCycle();
    };
    const timer = setTimeout(firstRun, 2000);

    const interval = setInterval(async () => {
      if (mounted) await runCycle();
    }, 15000);

    return () => {
      mounted = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  // ── Canvas setup + animation loop ──────────────────────────
  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    sizeRef.current = { w: rect.width, h: rect.height };
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
  }, []);

  useEffect(() => {
    setup();
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(() => setup());
    obs.observe(container);

    const bg = new Image();
    bg.src = "/sprite.png";
    bg.onload = () => { bgRef.current = bg; };

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    const draw = (timestamp: number) => {
      const { w, h } = sizeRef.current;
      if (w === 0 || h === 0) { animId = requestAnimationFrame(draw); return; }
      const a = animRef.current;
      if (!a.initialized) { a.initialized = true; }

      const dx = a.targetX - a.agentX;
      const dy = a.targetY - a.agentY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const isMoving = dist > 0.008;
      if (isMoving) {
        a.agentX += dx * 0.025;
        a.agentY += dy * 0.025;
        if (dx > 0.005) a.facingRight = true;
        else if (dx < -0.005) a.facingRight = false;
      }

      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = false;

      const size = Math.min(w, h);
      if (bgRef.current) {
        ctx.drawImage(bgRef.current, 0, 0, size, size);
      }

      const mapSize = size;
      const unit = mapSize;
      const px = a.agentX * mapSize;
      const py = a.agentY * mapSize;
      drawAgent(ctx, px, py, unit, timestamp, isMoving, a.facingRight);
      drawSpeechBubble(ctx, px, py, a.currentLabel, a.currentColor, unit);

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(animId); obs.disconnect(); };
  }, [setup]);

  // ── Stage badge color ──────────────────────────────────────
  const stageBadge: Record<AgentStage, { bg: string; text: string }> = {
    researching: { bg: "bg-[#4F6D7A]/20", text: "text-[#4F6D7A]" },
    retrieving: { bg: "bg-[#4B7F52]/20", text: "text-[#4B7F52]" },
    resting: { bg: "bg-[#DD6E42]/20", text: "text-[#DD6E42]" },
  };

  const visibleActivity = activity;

  return (
    <div className="col-span-2 row-span-2 flex flex-col overflow-hidden rounded-2xl bg-[#B1C6B4] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#2d4a30]">
          Agent Session
        </h2>
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-4 grid-rows-4 gap-3">
        {/* Map — 4x2 top full width */}
        <div ref={containerRef} className="col-span-4 row-span-2 overflow-hidden">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>

        {/* Activity feed — 4x2 bottom full width (ledger-based from HEAD) */}
        <div className="col-span-4 row-span-2 overflow-hidden bg-white/20 rounded-lg">
          <div className="flex items-center justify-between px-4 py-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#483519]/60">
              Platform Activity
              {masterTopicId && (
                <a
                  href={`https://hashscan.io/testnet/topic/${masterTopicId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 font-mono text-[10px] normal-case tracking-normal text-[#483519]/40 transition hover:text-[#483519]/70"
                >
                  (Master Topic: {masterTopicId})
                </a>
              )}
            </h3>
            <span className="rounded-full bg-[#483519]/15 px-2.5 py-0.5 text-xs font-bold text-[#483519]/80">
              {activity.length} Logs
            </span>
          </div>

          <div className="divide-y divide-[#483519]/5 overflow-y-auto" style={{ maxHeight: "calc(100% - 60px)" }}>
            {visibleActivity.map((a) => (
              <div key={a.id} className="flex items-start gap-3 px-4 py-2">
                <span className="mt-0.5 font-mono text-xs text-[#483519]/40">{a.id}</span>
                <span className={`mt-0.5 font-mono text-xs font-semibold ${TYPE_COLORS[a.type] || "text-[#483519]/70"}`}>
                  {a.type}
                </span>
                <span className="text-xs text-[#483519]/60">
                  bot: <span className="font-semibold text-[#483519]/80">{a.bot}</span>
                </span>
                <span className="ml-auto shrink-0 text-xs text-[#483519]/30">{a.time}</span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
