import { useRef, useEffect, useCallback, useState } from "react";
import { useAgent } from "@/contexts/AgentContext";

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
type AgentStage = "researching" | "retrieving" | "resting" | "subscribing";

const STAGE_CONFIG: Record<AgentStage, {
  label: string;
  target: { x: number; y: number };
  color: readonly number[];
}> = {
  researching: { label: "Researching...", target: { x: 0.18, y: 0.18 }, color: C.slate },
  retrieving:  { label: "Retrieving from Knowledge Layer...", target: { x: 0.78, y: 0.15 }, color: C.fern },
  resting:     { label: "Touching grass...", target: { x: 0.15, y: 0.75 }, color: C.peach },
  subscribing: { label: "Subscribing to gated knowledge...", target: { x: 0.80, y: 0.78 }, color: C.walnut },
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

// ── Chat message type ───────────────────────────────────────────
interface ChatMsg {
  role: "agent" | "system";
  content: string;
  stage?: AgentStage;
  timestamp: number;
}

// ── Subscription helpers ────────────────────────────────────────

function hssStatusNum(s: number | string): number {
  if (typeof s === "number") return s;
  const labels = ["None", "Pending", "Executed", "Failed", "Cancelled"];
  const idx = labels.findIndex((l) => l === s);
  return idx >= 0 ? idx : 0;
}

// ── Main Component ──────────────────────────────────────────────

export function AgentSession() {
  const { agent, privateKey } = useAgent();
  const evmAddress = agent?.evmAddress || "";

  // Canvas refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const bgRef = useRef<HTMLImageElement | null>(null);

  // LLM state
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [currentStage, setCurrentStage] = useState<AgentStage>("subscribing");
  const [running, setRunning] = useState(false);
  const conversationRef = useRef<{ role: string; content: string }[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Deterministic stage progression — frontend drives, not LLM
  const STAGE_SEQUENCE: AgentStage[] = ["subscribing", "retrieving", "researching", "resting"];
  const cycleRef = useRef(0);

  // Subscription state
  const [hasAccess, setHasAccess] = useState(false);
  const subCheckRef = useRef(false); // prevent parallel sub checks
  const reimburseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Activity log (real actions taken)
  const [activity, setActivity] = useState<{ id: string; type: string; detail: string; time: string }[]>([]);
  const activityCounter = useRef(0);
  const [expanded, setExpanded] = useState(false);

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

  // ── Activity logger ─────────────────────────────────────────
  const addActivity = useCallback((type: string, detail: string) => {
    activityCounter.current += 1;
    setActivity((prev) => [
      { id: `#${activityCounter.current}`, type, detail, time: "now" },
      ...prev,
    ].slice(0, 20));
  }, []);

  // ── Subscription: check access ──────────────────────────────
  const checkAccess = useCallback(async (): Promise<boolean> => {
    if (!evmAddress) return false;
    try {
      const res = await fetch("/api/spark/check-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriberAddress: evmAddress }),
      });
      const data = await res.json();
      const access = data.success && data.hasAccess;
      setHasAccess(access);
      return access;
    } catch {
      return false;
    }
  }, [evmAddress]);

  // ── Subscription: subscribe ─────────────────────────────────
  const doSubscribe = useCallback(async (): Promise<boolean> => {
    if (!evmAddress) return false;
    subCheckRef.current = true;
    try {
      // Check for existing reusable subscription
      const statusRes = await fetch("/api/subscription/status");
      const statusData = await statusRes.json();
      let reuseIdx = -1;
      if (statusData.success) {
        const myName = `gated-knowledge-${evmAddress.toLowerCase()}`;
        for (const sub of statusData.subscriptions || []) {
          if (sub.name.toLowerCase() !== myName) continue;
          const sn = hssStatusNum(sub.status);
          if (sn === 0 && sub.active) { reuseIdx = sub.idx; break; }
        }
      }

      if (reuseIdx >= 0) {
        // Reuse existing
        const startRes = await fetch("/api/subscription/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subIdx: reuseIdx }),
        });
        const startResult = await startRes.json();
        if (startResult.success) {
          addActivity("subscription_started", `Restarted sub #${reuseIdx}`);
          setHasAccess(true);
          return true;
        }
      }

      // Create new
      const res = await fetch("/api/subscription/subscribe-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "0x000000000000000000000000000000000079d730",
          name: `gated-knowledge-${evmAddress.toLowerCase()}`,
          amountPerPeriod: "1",
          intervalSeconds: 10,
        }),
      });
      const result = await res.json();
      if (!result.success) return false;

      // Find and start the new subscription
      const newStatusRes = await fetch("/api/subscription/status");
      const newStatusData = await newStatusRes.json();
      let latestIdx = 0;
      if (newStatusData.success && newStatusData.subscriptions?.length > 0) {
        latestIdx = newStatusData.subscriptions[newStatusData.subscriptions.length - 1].idx;
      }
      const startRes = await fetch("/api/subscription/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subIdx: latestIdx }),
      });
      const startResult = await startRes.json();
      if (startResult.success) {
        addActivity("subscription_created", `New subscription #${latestIdx} started`);
        setHasAccess(true);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      subCheckRef.current = false;
    }
  }, [evmAddress, addActivity]);

  // ── Subscription: reimburse operator ────────────────────────
  const reimburse = useCallback(async () => {
    if (!privateKey) return;
    try {
      await fetch("/api/spark/reimburse-operator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hederaPrivateKey: privateKey }),
      });
    } catch { /* silently continue */ }
  }, [privateKey]);

  // Start/stop reimburse timer when access changes
  useEffect(() => {
    if (hasAccess && privateKey) {
      reimburseRef.current = setInterval(reimburse, 10000);
    } else if (reimburseRef.current) {
      clearInterval(reimburseRef.current);
      reimburseRef.current = null;
    }
    return () => {
      if (reimburseRef.current) {
        clearInterval(reimburseRef.current);
        reimburseRef.current = null;
      }
    };
  }, [hasAccess, privateKey, reimburse]);

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
      addActivity("knowledge_retrieved", `Retrieved ${items.length} items from knowledge layer`);
      return `Found ${items.length} knowledge items:\n${sample}`;
    } catch {
      return "";
    }
  }, [addActivity]);

  // ── LLM chat cycle (deterministic stage progression) ──────
  const runCycle = useCallback(async () => {
    // Determine current stage from cycle counter
    const stage = STAGE_SEQUENCE[cycleRef.current % STAGE_SEQUENCE.length];
    setCurrentStage(stage);

    let knowledgeContext: string | undefined;

    // Execute stage-specific actions IMMEDIATELY
    if (stage === "subscribing") {
      const access = await checkAccess();
      if (!access) {
        setMessages((prev) => [...prev, {
          role: "system", content: "Checking subscription status... no access. Subscribing now.",
          stage: "subscribing", timestamp: Date.now(),
        }]);
        const ok = await doSubscribe();
        knowledgeContext = ok
          ? "Successfully subscribed to gated knowledge! Access granted."
          : "Subscription attempt failed. Will retry next cycle.";
      } else {
        knowledgeContext = "Subscription is active. Access confirmed.";
      }
    }

    if (stage === "retrieving") {
      knowledgeContext = await fetchKnowledge();
    }

    // Call LLM for narrative text (stage is forced by frontend)
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

      // Add to conversation history
      conversationRef.current.push(
        { role: "user", content: `[Stage: ${stage}]` },
        { role: "assistant", content: data.response },
      );

      // Add chat message — badge shows the CURRENT stage (not LLM's suggestion)
      setMessages((prev) => [...prev, {
        role: "agent",
        content: data.response,
        stage,
        timestamp: Date.now(),
      }]);

      // Determine next stage for activity log
      const nextStage = STAGE_SEQUENCE[(cycleRef.current + 1) % STAGE_SEQUENCE.length];
      addActivity("llm_response", `Stage: ${stage} → next: ${nextStage}`);

    } catch (err) {
      setMessages((prev) => [...prev, {
        role: "system",
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      }]);
    }

    // Advance cycle counter for next run
    cycleRef.current += 1;
  }, [fetchKnowledge, checkAccess, doSubscribe, addActivity]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Main loop: run every 15s ────────────────────────────────
  useEffect(() => {
    if (!agent || running) return;
    setRunning(true);

    // Initial message
    setMessages([{
      role: "system",
      content: "Agent session started. Beginning autonomous research cycle...",
      timestamp: Date.now(),
    }]);

    // Immediate first cycle
    let mounted = true;
    const firstRun = async () => {
      if (mounted) await runCycle();
    };
    const timer = setTimeout(firstRun, 2000);

    // Then every 15 seconds
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
    retrieving:  { bg: "bg-[#4B7F52]/20", text: "text-[#4B7F52]" },
    resting:     { bg: "bg-[#DD6E42]/20", text: "text-[#DD6E42]" },
    subscribing: { bg: "bg-[#483519]/20", text: "text-[#483519]" },
  };

  const visibleActivity = expanded ? activity : activity.slice(0, 3);

  const TYPE_COLORS: Record<string, string> = {
    llm_response: "text-[#4B7F52]",
    knowledge_retrieved: "text-[#4F6D7A]",
    subscription_created: "text-[#DD6E42]",
    subscription_started: "text-[#DD6E42]",
    subscription_expired: "text-[#dc2626]",
  };

  return (
    <div className="col-span-2 row-span-2 flex flex-col overflow-hidden rounded-2xl bg-[#4B7F52]/50 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#2d4a30]">
          Agent Session
        </h2>
        <div className="flex items-center gap-2">
          {hasAccess && (
            <span className="rounded-full bg-[#4B7F52]/30 px-2 py-0.5 text-[10px] font-bold text-[#2d4a30]">
              SUBSCRIBED
            </span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${stageBadge[currentStage].bg} ${stageBadge[currentStage].text}`}>
            {currentStage.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-4 grid-rows-4 gap-3">
        {/* Map — 2x2 top-left */}
        <div ref={containerRef} className="col-span-2 row-span-2 overflow-hidden">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>

        {/* Chat — 2x2 top-right */}
        <div className="col-span-2 row-span-2 flex flex-col overflow-hidden bg-white/30 rounded-lg">
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 && (
              <p className="text-xs text-[#483519]/40">Waiting for agent to start...</p>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`text-xs leading-relaxed ${msg.role === "system" ? "text-[#483519]/40 italic" : "text-[#483519]/80"}`}>
                {msg.role === "agent" && msg.stage && (
                  <span className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold ${stageBadge[msg.stage].bg} ${stageBadge[msg.stage].text}`}>
                    {msg.stage}
                  </span>
                )}
                {msg.content}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="flex items-center gap-2 border-t border-[#483519]/10 px-3 py-2">
            <div className="flex-1 text-[10px] text-[#483519]/30">
              Auto-cycling every 15s
            </div>
            <div className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-[#4B7F52]" : "bg-[#483519]/20"}`} />
          </div>
        </div>

        {/* Activity feed — 4x2 bottom full width */}
        <div className="col-span-4 row-span-2 overflow-hidden bg-white/20 rounded-lg">
          <div className="flex items-center justify-between px-4 py-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#483519]/60">Agent Activity</h3>
            <span className="rounded-full bg-[#483519]/15 px-2.5 py-0.5 text-xs font-bold text-[#483519]/80">
              {activity.length} events
            </span>
          </div>

          <div className="divide-y divide-[#483519]/5 overflow-y-auto" style={{ maxHeight: "calc(100% - 60px)" }}>
            {visibleActivity.length === 0 && (
              <div className="px-4 py-3 text-xs text-[#483519]/30">Waiting for activity...</div>
            )}
            {visibleActivity.map((a) => (
              <div key={a.id} className="flex items-start gap-3 px-4 py-2">
                <span className="mt-0.5 font-mono text-xs text-[#483519]/40">{a.id}</span>
                <span className={`mt-0.5 font-mono text-xs font-semibold ${TYPE_COLORS[a.type] || "text-[#483519]/70"}`}>
                  {a.type}
                </span>
                <span className="flex-1 truncate text-xs text-[#483519]/60">{a.detail}</span>
                <span className="ml-auto shrink-0 text-xs text-[#483519]/30">{a.time}</span>
              </div>
            ))}
          </div>

          {activity.length > 3 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full border-t border-[#483519]/5 py-1.5 text-xs font-medium text-[#483519]/40 transition hover:text-[#483519]/70"
            >
              {expanded ? "Show less" : `Show ${activity.length - 3} more...`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
