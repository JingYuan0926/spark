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
  retrieving: { label: "Retrieving from Knowledge Layer...", target: { x: 0.78, y: 0.15 }, color: C.fern },
  resting: { label: "Touching grass...", target: { x: 0.15, y: 0.75 }, color: C.peach },
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
    const iNft = msg.iNftTokenId ?? msg.inft_token_id ?? "";
    detail = `0G: ${evmAddr ? evmAddr.slice(0, 20) + "..." : "—"} | iNFT #${iNft}`;
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

// ── Subscription helpers ────────────────────────────────────────
function hssStatusNum(s: number | string): number {
  if (typeof s === "number") return s;
  const labels = ["None", "Pending", "Executed", "Failed", "Cancelled"];
  const idx = labels.findIndex((l) => l === s);
  return idx >= 0 ? idx : 0;
}

// ── Main Component ──────────────────────────────────────────────

export function AgentSession() {
  const { agent } = useAgent();
  const evmAddress = agent?.evmAddress || "";
  // Try to get privateKey if the context exposes it; fallback to empty string
  const privateKey = (agent as Record<string, unknown>)?.hederaPrivateKey as string || "";

  // Canvas refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const bgRef = useRef<HTMLImageElement | null>(null);

  // LLM state
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [currentStage, setCurrentStage] = useState<AgentStage>("subscribing");
  const [running, setRunning] = useState(false);
  const conversationRef = useRef<{ role: string; content: string }[]>([]);

  // Deterministic stage progression — frontend drives, not LLM
  const STAGE_SEQUENCE: AgentStage[] = ["subscribing", "retrieving", "researching", "resting"];
  const cycleRef = useRef(0);

  // Subscription state
  const [hasAccess, setHasAccess] = useState(false);
  const subCheckRef = useRef(false);
  const reimburseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Activity log (ledger-based from HEAD)
  const [expanded, setExpanded] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>(FALLBACK_ACTIVITY);
  const [masterTopicId, setMasterTopicId] = useState<string | null>(null);

  // Chat state (from HEAD — iNFT chat)
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: "user" | "agent"; text: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatLoading, messages]);

  async function handleChat() {
    if (!agent || !chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatHistory((prev) => [...prev, { role: "user", text: userMsg }]);
    setChatLoading(true);
    try {
      const res = await fetch("/api/inft/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: agent.iNftTokenId,
          message: userMsg,
          userAddress: agent.evmAddress,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatHistory((prev) => [...prev, { role: "agent", text: `Error: ${data.error}` }]);
      } else {
        setChatHistory((prev) => [
          ...prev,
          { role: "agent", text: data.response + (data.simulated ? " [simulated]" : "") },
        ]);
      }
    } catch (err: unknown) {
      setChatHistory((prev) => [
        ...prev,
        { role: "agent", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

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
        const startRes = await fetch("/api/subscription/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subIdx: reuseIdx }),
        });
        const startResult = await startRes.json();
        if (startResult.success) {
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
        setHasAccess(true);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      subCheckRef.current = false;
    }
  }, [evmAddress]);

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
  }, [fetchKnowledge, checkAccess, doSubscribe]);

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
    subscribing: { bg: "bg-[#483519]/20", text: "text-[#483519]" },
  };

  const visibleActivity = expanded ? activity : activity.slice(0, 3);

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

        {/* Chat — 2x2 top-right (iNFT chat from HEAD) */}
        <div className="col-span-2 row-span-2 flex flex-col overflow-hidden rounded-lg bg-white/30">
          <div className="border-b border-[#483519]/10 px-3 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#483519]/50">
              Chat with iNFT #{agent?.iNftTokenId ?? "—"}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {chatHistory.length === 0 && (
              <p className="mt-2 text-center text-xs text-[#483519]/30">
                Send a message to talk to your agent.
              </p>
            )}
            {chatHistory.map((msg, i) => (
              <div
                key={i}
                className={`mb-2 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-1.5 text-xs leading-relaxed ${msg.role === "user"
                      ? "bg-[#483519] text-white"
                      : "bg-[#483519]/10 text-[#483519]"
                    }`}
                  style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="mb-2 flex justify-start">
                <div className="rounded-xl bg-[#483519]/10 px-3 py-1.5 text-xs text-[#483519]/50">
                  Agent is thinking...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="flex items-center gap-2 border-t border-[#483519]/10 px-3 py-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !chatLoading && handleChat()}
              placeholder="Chat with your agent..."
              disabled={!agent || chatLoading}
              className="flex-1 rounded-lg border border-[#483519]/15 bg-white px-3 py-1.5 text-xs outline-none transition placeholder:text-[#483519]/30 focus:border-[#483519] focus:ring-1 focus:ring-[#483519] disabled:opacity-50"
            />
            <button
              onClick={handleChat}
              disabled={!agent || chatLoading || !chatInput.trim()}
              className="rounded-lg bg-[#483519] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#483519]/80 disabled:opacity-50"
            >
              {chatLoading ? "..." : "Send"}
            </button>
          </div>
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
