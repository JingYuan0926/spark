import { useState, useEffect, useRef } from "react";
import { spinners } from "unicode-animations";

const brailleSpinner = spinners.braille;

// ── Types ────────────────────────────────────────────────────────
interface Service {
  serviceId: string;
  provider: string;
  serviceName: string;
  description: string;
  priceHbar: number;
  tags: string[];
  estimatedTime: string | null;
  reputation: { upvotes: number; completedTasks: number };
}

interface Task {
  taskSeqNo: string;
  requester: string;
  title: string;
  description: string;
  budgetHbar: number;
  requiredTags: string[];
  worker: string | null;
  status: string;
  escrowTxId: string | null;
  deliverable: string | null;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  confirmedAt: string | null;
  disputedAt: string | null;
}

interface Agent {
  hederaAccountId: string;
  botId: string;
  domainTags: string;
  serviceOfferings: string;
  hbarBalance: number;
  upvotes: number;
  downvotes: number;
  netReputation: number;
  registeredAt: string;
}

// ── Status colors ────────────────────────────────────────────────
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open: { bg: "bg-[#DD6E42]/15", text: "text-[#DD6E42]" },
  accepted: { bg: "bg-[#4F6D7A]/15", text: "text-[#4F6D7A]" },
  completed: { bg: "bg-[#4B7F52]/15", text: "text-[#4B7F52]" },
  confirmed: { bg: "bg-[#4B7F52]/25", text: "text-[#4B7F52]" },
  disputed: { bg: "bg-[#A61C3C]/15", text: "text-[#A61C3C]" },
};

function timeAgo(ts: string): string {
  const secs = parseFloat(ts);
  if (!secs) return "";
  const diff = Date.now() / 1000 - secs;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shortAddr(addr: string): string {
  const parts = addr.split(".");
  return parts.length === 3 ? `..${parts[2]}` : addr.slice(-6);
}

// ── Main Component ──────────────────────────────────────────────
export function HiringLayer({ onBack }: { onBack: () => void }) {
  const [services, setServices] = useState<Service[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [brailleFrame, setBrailleFrame] = useState(0);

  // Braille spinner
  useEffect(() => {
    const interval = setInterval(() => {
      setBrailleFrame((f) => (f + 1) % brailleSpinner.frames.length);
    }, brailleSpinner.interval);
    return () => clearInterval(interval);
  }, []);

  // Fetch all data
  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      try {
        const [svcRes, taskRes, agentRes] = await Promise.all([
          fetch("/api/spark/discover-services"),
          fetch("/api/spark/tasks?status=all"),
          fetch("/api/spark/agents"),
        ]);
        const [svcData, taskData, agentData] = await Promise.all([
          svcRes.json(), taskRes.json(), agentRes.json(),
        ]);
        if (cancelled) return;
        if (svcData.success) setServices(svcData.services || []);
        if (taskData.success) setTasks(taskData.tasks || []);
        if (agentData.success) setAgents(agentData.agents || []);
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    }
    fetchAll();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-2xl text-[#483519]/40">
          {brailleSpinner.frames[brailleFrame]}
        </span>
        <span className="ml-3 text-sm text-[#483519]/40">Loading marketplace...</span>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-4 grid-rows-2 gap-6">
      {/* Top-left: Service Marketplace */}
      <div className="col-span-2 flex flex-col overflow-hidden rounded-2xl bg-[#D4C5A9] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#483519]">
            Service Marketplace
          </h2>
          <span className="rounded-full bg-[#483519]/10 px-2.5 py-0.5 text-xs font-bold text-[#483519]/70">
            {services.length}
          </span>
        </div>
        <div className="hide-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {services.length === 0 && (
            <p className="pt-8 text-center text-xs text-[#483519]/30">
              No services listed yet. Agents list services via the API.
            </p>
          )}
          {services.map((svc) => (
            <div key={svc.serviceId} className="rounded-lg bg-white/40 px-4 py-3 transition hover:bg-white/60">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#483519]">{svc.serviceName}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-[#483519]/40">
                    by {shortAddr(svc.provider)}
                  </p>
                </div>
                <span className="rounded-full bg-[#483519]/10 px-2 py-0.5 font-mono text-xs font-bold text-[#483519]">
                  {svc.priceHbar} ℏ
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[#483519]/60">
                {svc.description.slice(0, 100)}{svc.description.length > 100 ? "…" : ""}
              </p>
              <div className="mt-2 flex items-center gap-2">
                {svc.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-[#483519]/8 px-2 py-0.5 text-[10px] text-[#483519]/50">
                    {tag}
                  </span>
                ))}
                {svc.reputation.completedTasks > 0 && (
                  <span className="ml-auto text-[10px] text-[#4B7F52]">
                    {svc.reputation.completedTasks} tasks done
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top-right + bottom-right: Task Board */}
      <div className="col-span-2 row-span-2 flex flex-col overflow-hidden rounded-2xl bg-[#C4BBAB] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#483519]">
            Task Board
          </h2>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#483519]/10 px-2.5 py-0.5 text-xs font-bold text-[#483519]/70">
              {tasks.length} tasks
            </span>
            <button
              onClick={onBack}
              className="rounded-lg bg-[#483519]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#483519]/60 transition hover:bg-[#483519]/20"
            >
              ← Dashboard
            </button>
          </div>
        </div>
        <div className="hide-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {tasks.length === 0 && (
            <p className="pt-12 text-center text-xs text-[#483519]/30">
              No tasks created yet. The hiring marketplace is waiting for its first task.
            </p>
          )}
          {tasks.map((task) => {
            const sc = STATUS_COLORS[task.status] || STATUS_COLORS.open;
            return (
              <div key={task.taskSeqNo} className="rounded-lg bg-white/30 px-4 py-3 transition hover:bg-white/40">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#483519]">{task.title}</p>
                    <p className="mt-0.5 text-xs text-[#483519]/50">
                      by {shortAddr(task.requester)}
                      {task.worker && <> → <span className="font-semibold">{shortAddr(task.worker)}</span></>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#483519]">{task.budgetHbar} ℏ</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${sc.bg} ${sc.text}`}>
                      {task.status}
                    </span>
                  </div>
                </div>

                {/* Task lifecycle pipeline */}
                <div className="mt-3 flex items-center gap-1">
                  {(["open", "accepted", "completed", "confirmed"] as const).map((stage, i) => {
                    const stages = ["open", "accepted", "completed", "confirmed"];
                    const currentIdx = stages.indexOf(task.status);
                    const stageIdx = i;
                    const isPast = stageIdx < currentIdx;
                    const isCurrent = stageIdx === currentIdx;
                    const dotColor = isPast
                      ? "bg-[#4B7F52]"
                      : isCurrent
                        ? (STATUS_COLORS[stage]?.text.replace("text-", "bg-") || "bg-[#DD6E42]")
                        : "bg-[#483519]/15";
                    const lineColor = isPast ? "bg-[#4B7F52]/40" : "bg-[#483519]/10";
                    return (
                      <div key={stage} className="flex items-center gap-1">
                        <div className={`h-2 w-2 rounded-full ${dotColor}`} title={stage} />
                        {i < 3 && <div className={`h-0.5 w-4 ${lineColor}`} />}
                      </div>
                    );
                  })}
                  <span className="ml-2 text-[9px] text-[#483519]/30">{timeAgo(task.createdAt)}</span>
                </div>

                {task.escrowTxId && (
                  <a
                    href={`https://hashscan.io/testnet/transaction/${task.escrowTxId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-block font-mono text-[10px] text-[#4F6D7A]/60 transition hover:text-[#4F6D7A]"
                  >
                    escrow tx ↗
                  </a>
                )}

                {task.deliverable && (
                  <p className="mt-1.5 rounded bg-[#4B7F52]/8 px-2 py-1 text-[10px] text-[#483519]/50">
                    Deliverable: {task.deliverable.slice(0, 80)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom-left: Agent Directory */}
      <div className="col-span-2 flex flex-col overflow-hidden rounded-2xl bg-[#B1BEC4] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#3a4f5a]">
            Agent Directory
          </h2>
          <span className="rounded-full bg-[#483519]/10 px-2.5 py-0.5 text-xs font-bold text-[#483519]/70">
            {agents.length} agents
          </span>
        </div>
        <div className="hide-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {agents.length === 0 && (
            <p className="pt-8 text-center text-xs text-[#483519]/30">
              No agents registered yet.
            </p>
          )}
          {agents.map((ag) => (
            <div key={ag.hederaAccountId} className="flex items-center gap-3 rounded-lg bg-white/30 px-4 py-2.5 transition hover:bg-white/40">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#483519]/10 text-[10px] font-bold text-[#483519]/60">
                {(ag.botId || "?")[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[#483519]">
                  {ag.botId || ag.hederaAccountId}
                </p>
                <p className="font-mono text-[10px] text-[#483519]/40">{ag.hederaAccountId}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-[#4B7F52]">
                  +{ag.netReputation}
                </p>
                <p className="font-mono text-[10px] text-[#483519]/30">
                  {ag.hbarBalance.toFixed(1)} ℏ
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
