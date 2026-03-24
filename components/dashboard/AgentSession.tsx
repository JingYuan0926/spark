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

const AGENT_BODY_COLORS: readonly (readonly number[])[] = [
  C.fern,            // green
  C.peach,           // orange
  C.slate,           // blue-grey
  [139, 90, 43],     // brown
  [168, 85, 110],    // mauve
  [90, 130, 160],    // steel blue
  [180, 140, 60],    // gold
];

function drawAgent(
  ctx: CanvasRenderingContext2D,
  px: number, py: number,
  unit: number, timestamp: number,
  isMoving: boolean, facingRight: boolean,
  bodyColor: readonly number[] = C.fern,
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
  ctx.fillStyle = rgba(bodyColor, 0.85);
  ctx.beginPath();
  ctx.roundRect(x - bw * 0.35, y + bh / 2 - legH * 0.3 + legSwing, legW, legH, 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x + bw * 0.05, y + bh / 2 - legH * 0.3 - legSwing, legW, legH, 2);
  ctx.fill();

  const bpSide = facingRight ? -1 : 1;
  ctx.fillStyle = rgba(bodyColor, 0.65);
  ctx.beginPath();
  ctx.roundRect(x + bpSide * bw * 0.38, y - bh * 0.05, bw * 0.2, bh * 0.35, 3);
  ctx.fill();

  ctx.fillStyle = rgba(bodyColor, 0.85);
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

function drawPlazaFloor(ctx: CanvasRenderingContext2D, size: number) {
  // Warm sandy floor
  ctx.fillStyle = "#d4c5a9";
  ctx.fillRect(0, 0, size, size);

  // Subtle border
  ctx.strokeStyle = rgba(C.walnut, 0.12);
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, size - 12, size - 12);

  // Center circle — meeting point
  ctx.strokeStyle = rgba(C.walnut, 0.08);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.12, 0, Math.PI * 2);
  ctx.stroke();

  // Small dot in center
  ctx.fillStyle = rgba(C.walnut, 0.06);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 3, 0, Math.PI * 2);
  ctx.fill();

  // Label
  ctx.fillStyle = rgba(C.walnut, 0.15);
  ctx.font = `600 ${Math.max(8, size * 0.022)}px "Space Grotesk", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("PUBLIC SPACE", size / 2, 12);
}

// Plaza agent state
interface PlazaAgentState {
  id: string;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  facingRight: boolean;
  colorIdx: number;
  lastBubble: string;
  bubbleColor: readonly number[];
  bubbleExpiry: number;
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  px: number, py: number,
  label: string, color: readonly number[],
  unit: number,
) {
  const fontSize = Math.max(9, unit * 0.024);
  ctx.font = `600 ${fontSize}px "Space Grotesk", sans-serif`;
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
  seqNo: number;
  consensusTimestamp: string;
  type: string;
  action: string;
  bot: string;
  target: string;
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

// Brief action verbs for the activity feed
const ACTION_BRIEFS: Record<string, string> = {
  topics_initialized: "initialized",
  agent_registered: "registered",
  hcs11_profile: "set profile",
  service_listed: "listed",
  task_created: "created task",
  task_accepted: "accepted task",
  task_completed: "submitted work",
  task_confirmed: "confirmed",
  task_disputed: "disputed",
  task_comment: "commented",
  task_price_proposal: "proposed price",
  task_price_response: "responded",
  knowledge_submitted: "submitted",
  vote_cast: "voted",
  heartbeat: "heartbeat",
  review: "reviewed",
  hcs10_registry: "registered",
  hcs20_deploy: "deployed token",
};

function parseActivity(msg: Record<string, unknown>, seqNo: number): ActivityEntry {
  // Resolve action: check HCS standard protocol field first
  let action = (msg.action as string) || "";
  if (!action) {
    if (msg.p === "hcs-10") action = "hcs10_registry";
    else if (msg.p === "hcs-11") action = "hcs11_profile";
    else if (msg.p === "hcs-2" && msg.type === "review") action = "review";
    else if (msg.p === "hcs-20") action = "hcs20_deploy";
    else action = (msg.type as string) || "unknown";
  }
  const brief = ACTION_BRIEFS[action] || action.replace(/_/g, " ");
  const bot = (msg.botId as string)
    || (msg.hederaAccountId as string)
    || (msg.requester as string)
    || (msg.author as string)
    || (msg.worker as string)
    || (msg.reviewer as string)
    || "system";
  const time = msg._consensusAt ? timeAgo(msg._consensusAt as string) : "";

  // Extract target (the "other party")
  let target = "";
  let detail = "";

  if (action === "review") {
    target = (msg.targetAgent as string) || "";
  } else if (action === "task_accepted") {
    target = (msg.requester as string) || "";
    detail = (msg.title as string) || "";
  } else if (action === "task_created") {
    target = (msg.workerAccountId as string) || "";
    detail = (msg.title as string) || "";
  } else if (action === "task_completed" || action === "task_confirmed" || action === "task_disputed") {
    detail = (msg.title as string) || "";
  } else if (action === "task_comment" || action === "task_price_proposal") {
    detail = (msg.message as string) || "";
    if (detail.length > 40) detail = detail.slice(0, 40) + "...";
  } else if (action === "service_listed") {
    detail = (msg.serviceName as string) || "";
  } else if (action === "knowledge_submitted") {
    detail = (msg.category as string) || "";
  } else if (action === "vote_cast") {
    target = (msg.targetBot as string) || "";
  } else if (action === "hcs20_deploy") {
    detail = (msg.tick as string) || "";
  }

  const consensusTimestamp = (msg._consensusAt as string) || "";
  return { id: `#${seqNo}`, seqNo, consensusTimestamp, type: brief, action, bot, target, time, detail };
}

const FALLBACK_ACTIVITY: ActivityEntry[] = [
  { id: "#—", seqNo: 0, consensusTimestamp: "", type: "info", action: "info", bot: "system", target: "", time: "", detail: "Loading master topic logs..." },
];

const ACTION_COLORS: Record<string, string> = {
  agent_registered: "text-[#4B7F52]",
  hcs10_registry: "text-[#4B7F52]",
  hcs11_profile: "text-[#4B7F52]",
  knowledge_submitted: "text-[#4F6D7A]",
  vote_cast: "text-[#DD6E42]",
  review: "text-[#DD6E42]",
  task_created: "text-[#4F6D7A]",
  task_accepted: "text-[#4F6D7A]",
  task_completed: "text-[#4B7F52]",
  task_confirmed: "text-[#4B7F52]",
  task_disputed: "text-[#A61C3C]",
  service_listed: "text-[#483519]/70",
  heartbeat: "text-[#483519]/40",
  hcs20_deploy: "text-[#483519]/50",
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

  // Office canvas refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const bgRef = useRef<HTMLImageElement | null>(null);

  // Plaza canvas refs
  const plazaContainerRef = useRef<HTMLDivElement>(null);
  const plazaCanvasRef = useRef<HTMLCanvasElement>(null);
  const plazaSizeRef = useRef({ w: 0, h: 0 });
  const plazaAgentsRef = useRef<PlazaAgentState[]>([]);
  const plazaInitRef = useRef(false);

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
  const [agentNameMap, setAgentNameMap] = useState<Record<string, string>>({});

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

  // ── Plaza canvas setup + animation ─────────────────────────
  const plazaSetup = useCallback(() => {
    const canvas = plazaCanvasRef.current;
    const container = plazaContainerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    plazaSizeRef.current = { w: rect.width, h: rect.height };
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
  }, []);

  // Fetch registered agents for plaza
  useEffect(() => {
    let cancelled = false;
    async function fetchAgents() {
      try {
        const res = await fetch("/api/spark/agents");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.success) return;
        const agents: { hederaAccountId: string; botId: string }[] = data.agents || [];
        // Build name lookup map
        const nameMap: Record<string, string> = {};
        for (const a of agents) {
          if (a.hederaAccountId && a.botId) nameMap[a.hederaAccountId] = a.botId;
        }
        if (!cancelled) setAgentNameMap(nameMap);
        if (agents.length === 0) return;

        // Seed plaza agents at random positions
        const seeded: PlazaAgentState[] = agents.slice(0, 8).map((a, i) => {
          const x = 0.2 + Math.random() * 0.6;
          const y = 0.25 + Math.random() * 0.55;
          return {
            id: a.hederaAccountId,
            name: a.botId || `Agent-${a.hederaAccountId.split(".").pop()}`,
            x, y,
            targetX: x, targetY: y,
            facingRight: Math.random() > 0.5,
            colorIdx: i % AGENT_BODY_COLORS.length,
            lastBubble: "",
            bubbleColor: AGENT_BODY_COLORS[i % AGENT_BODY_COLORS.length],
            bubbleExpiry: 0,
          };
        });
        plazaAgentsRef.current = seeded;
        plazaInitRef.current = true;
      } catch { /* ignore */ }
    }
    fetchAgents();
    return () => { cancelled = true; };
  }, []);

  // Randomize plaza agent targets every 4s
  useEffect(() => {
    const interval = setInterval(() => {
      for (const ag of plazaAgentsRef.current) {
        ag.targetX = 0.15 + Math.random() * 0.7;
        ag.targetY = 0.2 + Math.random() * 0.6;
      }
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Show activity as speech bubbles on random plaza agents
  useEffect(() => {
    if (activity.length <= 1) return;
    // Pick a random agent and show the latest activity as a bubble
    const agents = plazaAgentsRef.current;
    if (agents.length === 0) return;
    const latest = activity[0]; // newest
    const randomAgent = agents[Math.floor(Math.random() * agents.length)];
    randomAgent.lastBubble = latest.type.replace(/_/g, " ");
    randomAgent.bubbleExpiry = Date.now() + 5000;
  }, [activity]);

  // Plaza animation loop
  useEffect(() => {
    plazaSetup();
    const container = plazaContainerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(() => plazaSetup());
    obs.observe(container);

    const canvas = plazaCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    const draw = (timestamp: number) => {
      const { w, h } = plazaSizeRef.current;
      if (w === 0 || h === 0) { animId = requestAnimationFrame(draw); return; }

      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = false;

      const size = Math.min(w, h);
      drawPlazaFloor(ctx, size);

      const agents = plazaAgentsRef.current;
      const now = Date.now();

      for (const ag of agents) {
        // Move toward target
        const dx = ag.targetX - ag.x;
        const dy = ag.targetY - ag.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const isMoving = dist > 0.008;
        if (isMoving) {
          ag.x += dx * 0.015;
          ag.y += dy * 0.015;
          if (dx > 0.005) ag.facingRight = true;
          else if (dx < -0.005) ag.facingRight = false;
        }

        const px = ag.x * size;
        const py = ag.y * size;
        const color = AGENT_BODY_COLORS[ag.colorIdx];
        drawAgent(ctx, px, py, size, timestamp, isMoving, ag.facingRight, color);

        // Show name label below agent
        ctx.fillStyle = rgba(C.walnut, 0.5);
        ctx.font = `500 ${Math.max(7, size * 0.018)}px "Space Grotesk", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(ag.name, px, py + size * 0.04);

        // Show speech bubble if active
        if (ag.lastBubble && now < ag.bubbleExpiry) {
          drawSpeechBubble(ctx, px, py, ag.lastBubble, ag.bubbleColor, size);
        }
      }

      // Empty state
      if (agents.length === 0) {
        ctx.fillStyle = rgba(C.walnut, 0.2);
        ctx.font = `500 ${Math.max(10, size * 0.025)}px "Space Grotesk", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Waiting for agents...", size / 2, size / 2);
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(animId); obs.disconnect(); };
  }, [plazaSetup]);

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
        {/* Map — left: office, right: public plaza */}
        <div ref={containerRef} className="col-span-2 row-span-2 overflow-hidden rounded-lg">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
        <div ref={plazaContainerRef} className="col-span-2 row-span-2 overflow-hidden rounded-lg">
          <canvas ref={plazaCanvasRef} className="h-full w-full" />
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

          <div className="hide-scrollbar divide-y divide-[#483519]/5 overflow-y-auto" style={{ maxHeight: "calc(100% - 60px)", scrollbarWidth: "none" }}>
            {visibleActivity.map((a) => {
              const fromLabel = agentNameMap[a.bot] ? `${agentNameMap[a.bot]} (${a.bot})` : a.bot;
              const toLabel = a.target ? (agentNameMap[a.target] ? `${agentNameMap[a.target]} (${a.target})` : a.target) : "";
              const txUrl = a.consensusTimestamp
                ? `https://hashscan.io/testnet/transaction/${a.consensusTimestamp}`
                : null;
              return (
                <div
                  key={a.id}
                  className="flex items-center gap-2 px-4 py-2 text-xs"
                >
                  <span className="shrink-0 font-mono text-[#483519]/30">{a.id}</span>
                  <span className="shrink-0 font-semibold text-[#483519]/70">{fromLabel}</span>
                  <span className={`shrink-0 ${ACTION_COLORS[a.action] || "text-[#483519]/50"}`}>{a.type}</span>
                  {toLabel && (
                    <>
                      <span className="shrink-0 text-[#483519]/30">→</span>
                      <span className="shrink-0 font-semibold text-[#483519]/60">{toLabel}</span>
                    </>
                  )}
                  {a.detail && (
                    <span className="min-w-0 truncate text-[#483519]/35">{a.detail}</span>
                  )}
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[#483519]/25">
                    {a.time}
                    {txUrl && (
                      <a href={txUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="ml-1 text-[#483519]/30 transition hover:text-[#483519]/60">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                      </a>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

        </div>
      </div>
    </div>
  );
}
