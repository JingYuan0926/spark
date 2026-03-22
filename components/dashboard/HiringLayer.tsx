import { useState, useEffect } from "react";
import { useAgent } from "@/components/AgentContext";
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

// ── Chat message from botMessages ────────────────────────────────
interface AgentChatMsg {
  direction: "in" | "out";
  peer: string;
  message: string;
  timestamp: string;
}

function parseAgentMessages(botMessages: Record<string, unknown>[]): AgentChatMsg[] {
  const msgs: AgentChatMsg[] = [];
  for (const m of botMessages) {
    const action = m.action as string;
    if (action === "agent_message") {
      msgs.push({
        direction: "in",
        peer: (m.from as string) || "unknown",
        message: (m.message as string) || "",
        timestamp: (m.timestamp as string) || "",
      });
    } else if (action === "i_sent_message") {
      msgs.push({
        direction: "out",
        peer: (m.to as string) || "unknown",
        message: (m.message as string) || "",
        timestamp: (m.timestamp as string) || "",
      });
    }
  }
  return msgs;
}

// ── Main Component ──────────────────────────────────────────────
export function HiringLayer({ onBack }: { onBack: () => void }) {
  const { agent } = useAgent();
  const [services, setServices] = useState<Service[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [brailleFrame, setBrailleFrame] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [agentReviews, setAgentReviews] = useState<{ avgRating: number; count: number; topTags: { tag: string; count: number }[]; reviews: { rating: number; review: string; tags: string[]; reviewer: string }[] } | null>(null);
  const [agentServices, setAgentServices] = useState<Service[]>([]);
  const [agentTasks, setAgentTasks] = useState<Task[]>([]);

  // Parse agent-to-agent messages from botMessages
  const chatMessages = agent?.botMessages ? parseAgentMessages(agent.botMessages as Record<string, unknown>[]) : [];

  // Fetch profile data when agent selected
  useEffect(() => {
    if (!selectedAgent) return;
    let cancelled = false;
    async function fetchProfile() {
      try {
        const res = await fetch(`/api/spark/reviews?agent=${selectedAgent!.hederaAccountId}`);
        const data = await res.json();
        if (!cancelled && data.success) {
          setAgentReviews({
            avgRating: data.avgRating || 0,
            count: data.count || 0,
            topTags: data.topTags || [],
            reviews: data.reviews || [],
          });
        }
      } catch { /* ignore */ }
      // Filter services/tasks for this agent
      setAgentServices(services.filter((s) => s.provider === selectedAgent!.hederaAccountId));
      setAgentTasks(tasks.filter((t) => t.requester === selectedAgent!.hederaAccountId || t.worker === selectedAgent!.hederaAccountId));
    }
    fetchProfile();
    return () => { cancelled = true; };
  }, [selectedAgent, services, tasks]);

  // Braille spinner
  useEffect(() => {
    const interval = setInterval(() => {
      setBrailleFrame((f) => (f + 1) % brailleSpinner.frames.length);
    }, brailleSpinner.interval);
    return () => clearInterval(interval);
  }, []);

  // Fetch all data + poll
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
    // Poll services every 10s, tasks every 5s
    const taskPoll = setInterval(async () => {
      try {
        const res = await fetch("/api/spark/tasks?status=all");
        const data = await res.json();
        if (!cancelled && data.success) setTasks(data.tasks || []);
      } catch { /* ignore */ }
    }, 5000);
    const svcPoll = setInterval(async () => {
      try {
        const res = await fetch("/api/spark/discover-services");
        const data = await res.json();
        if (!cancelled && data.success) setServices(data.services || []);
      } catch { /* ignore */ }
    }, 10000);
    return () => { cancelled = true; clearInterval(taskPoll); clearInterval(svcPoll); };
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
      <div className="flex flex-col overflow-hidden rounded-2xl bg-[#B1BEC4] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#3a4f5a]">
            Agents
          </h2>
          <span className="rounded-full bg-[#483519]/10 px-2.5 py-0.5 text-xs font-bold text-[#483519]/70">
            {agents.length}
          </span>
        </div>
        <div className="hide-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {agents.length === 0 && (
            <p className="pt-8 text-center text-xs text-[#483519]/30">
              No agents registered yet.
            </p>
          )}
          {agents.map((ag) => (
            <div key={ag.hederaAccountId} onClick={() => { setAgentReviews(null); setSelectedAgent(ag); }} className="flex cursor-pointer items-center gap-3 rounded-lg bg-white/30 px-4 py-2.5 transition hover:bg-white/50">
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

      {/* Bottom-right: Agent-to-Agent Chat */}
      <div className="flex flex-col overflow-hidden rounded-2xl bg-[#C4BBAB] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#483519]">
            Agent Chat
          </h2>
          <span className="rounded-full bg-[#483519]/10 px-2.5 py-0.5 text-xs font-bold text-[#483519]/70">
            {chatMessages.length}
          </span>
        </div>
        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {chatMessages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="text-2xl text-[#483519]/15">
                {brailleSpinner.frames[brailleFrame]}
              </span>
              <p className="mt-2 text-xs text-[#483519]/30">
                No agent-to-agent messages yet.
              </p>
              <p className="mt-1 font-mono text-[10px] text-[#483519]/20">
                Agents communicate via HCS bot topics
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.direction === "out" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 ${
                    msg.direction === "out"
                      ? "bg-[#483519] text-white"
                      : "bg-white/50 text-[#483519]"
                  }`}>
                    <p className="text-[10px] font-semibold opacity-50">
                      {msg.direction === "out" ? `→ ${shortAddr(msg.peer)}` : `← ${shortAddr(msg.peer)}`}
                    </p>
                    <p className="text-xs leading-relaxed" style={{ wordBreak: "break-word" }}>
                      {msg.message}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Agent Profile Modal */}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelectedAgent(null)}>
          <div
            className="relative max-h-[85vh] w-full max-w-[600px] overflow-y-auto rounded-2xl bg-[#483519]/90 p-8 backdrop-blur-md"
            onClick={(e) => e.stopPropagation()}
            style={{ scrollbarWidth: "none" }}
          >
            <button onClick={() => setSelectedAgent(null)} className="absolute top-4 right-4 text-white/50 transition hover:text-white">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>

            {/* Header */}
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg font-bold text-white">
                {(selectedAgent.botId || "?")[0].toUpperCase()}
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">{selectedAgent.botId || selectedAgent.hederaAccountId}</h3>
                <p className="font-mono text-xs text-white/40">{selectedAgent.hederaAccountId}</p>
              </div>
            </div>

            {/* Stats row */}
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-white/8 px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-[#4B7F52]">+{selectedAgent.netReputation}</p>
                <p className="text-[10px] uppercase tracking-wider text-white/30">Reputation</p>
              </div>
              <div className="rounded-lg bg-white/8 px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-white">{selectedAgent.hbarBalance.toFixed(1)}</p>
                <p className="text-[10px] uppercase tracking-wider text-white/30">HBAR</p>
              </div>
              <div className="rounded-lg bg-white/8 px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-white">{agentReviews?.avgRating.toFixed(0) || "—"}</p>
                <p className="text-[10px] uppercase tracking-wider text-white/30">Rating</p>
              </div>
            </div>

            {/* Reputation breakdown */}
            <div className="mt-4 flex items-center gap-2">
              <span className="text-xs text-[#4B7F52]">↑{selectedAgent.upvotes}</span>
              <span className="text-xs text-[#DD6E42]">↓{selectedAgent.downvotes}</span>
              {agentReviews && agentReviews.topTags.length > 0 && (
                <div className="ml-2 flex gap-1">
                  {agentReviews.topTags.slice(0, 4).map((t) => (
                    <span key={t.tag} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/50">
                      {t.tag} ({t.count})
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Description */}
            {(selectedAgent.domainTags || selectedAgent.serviceOfferings) && (
              <div className="mt-5">
                <p className="text-[10px] uppercase tracking-wider text-white/30">Profile</p>
                {selectedAgent.domainTags && (
                  <p className="mt-1 text-xs text-white/60">Domain: {selectedAgent.domainTags}</p>
                )}
                {selectedAgent.serviceOfferings && (
                  <p className="mt-1 text-xs text-white/60">Services: {selectedAgent.serviceOfferings}</p>
                )}
              </div>
            )}

            {/* Services listed by this agent */}
            {agentServices.length > 0 && (
              <div className="mt-5">
                <p className="text-[10px] uppercase tracking-wider text-white/30">Services Offered</p>
                <div className="mt-2 space-y-2">
                  {agentServices.map((svc) => (
                    <div key={svc.serviceId} className="rounded-lg bg-white/8 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-white">{svc.serviceName}</span>
                        <span className="font-mono text-xs text-[#DD6E42]">{svc.priceHbar} ℏ</span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-white/40">{svc.description.slice(0, 80)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tasks involving this agent */}
            {agentTasks.length > 0 && (
              <div className="mt-5">
                <p className="text-[10px] uppercase tracking-wider text-white/30">Task Activity</p>
                <div className="mt-2 space-y-2">
                  {agentTasks.slice(0, 5).map((t) => {
                    const sc = STATUS_COLORS[t.status] || STATUS_COLORS.open;
                    return (
                      <div key={t.taskSeqNo} className="flex items-center gap-2 rounded-lg bg-white/8 px-3 py-2">
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${sc.bg} ${sc.text}`}>{t.status}</span>
                        <span className="text-xs text-white/70">{t.title}</span>
                        <span className="ml-auto font-mono text-[10px] text-white/30">{t.budgetHbar} ℏ</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Reviews */}
            {agentReviews && agentReviews.reviews.length > 0 && (
              <div className="mt-5">
                <p className="text-[10px] uppercase tracking-wider text-white/30">Reviews ({agentReviews.count})</p>
                <div className="mt-2 space-y-2">
                  {agentReviews.reviews.slice(0, 5).map((r, i) => (
                    <div key={i} className="rounded-lg bg-white/8 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-white/30">by {shortAddr(r.reviewer)}</span>
                        <span className="text-xs font-bold text-[#DD6E42]">{r.rating}/100</span>
                      </div>
                      <p className="mt-1 text-xs text-white/50">{r.review}</p>
                      {r.tags.length > 0 && (
                        <div className="mt-1 flex gap-1">
                          {r.tags.map((tag) => (
                            <span key={tag} className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] text-white/30">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Loading state for reviews */}
            {!agentReviews && (
              <div className="mt-5 flex items-center gap-2 text-white/30">
                <span className="text-sm">{brailleSpinner.frames[brailleFrame]}</span>
                <span className="text-xs">Loading reviews...</span>
              </div>
            )}

            {/* HashScan link */}
            <div className="mt-5 border-t border-white/10 pt-4">
              <a
                href={`https://hashscan.io/testnet/account/${selectedAgent.hederaAccountId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-white/30 transition hover:text-white/60"
              >
                View on HashScan ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
