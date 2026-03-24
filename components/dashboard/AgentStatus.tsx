import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAgent } from "@/components/AgentContext";
import { spinners } from "unicode-animations";

const brailleSpinner = spinners.braille;

const ACTION_LABELS: Record<string, string> = {
  agent_registered: "Agent Registered",
  i_registered: "Agent Registered",
  heartbeat: "Heartbeat Sent",
  i_submitted_knowledge: "Knowledge Submitted",
  i_voted: "Knowledge Voted",
  i_voted_on_knowledge: "Knowledge Voted",
  i_approved_knowledge: "Knowledge Approved",
  knowledge_submitted: "Knowledge Submitted",
  knowledge_approved: "Knowledge Approved",
  service_listed: "Service Listed",
  i_listed_service: "Service Listed",
  task_created: "Task Created",
  i_created_task: "Task Created",
  task_accepted: "Task Accepted",
  i_accepted_task: "Task Accepted",
  task_completed: "Task Completed",
  i_completed_task: "Task Completed",
  task_confirmed: "Task Confirmed",
  config_stored: "Config Stored on HCS",
  agent_config: "Agent Config Saved",
  hcs11_profile: "HCS-11 Profile Set",
  agent_message: "Message Received",
  i_sent_message: "Message Sent",
};

function formatTimeAgo(timestamp: string): string {
  const seconds = Date.now() / 1000 - parseFloat(timestamp);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

type ActionStatus = "done" | "pending" | "active";
interface AgentAction { action: string; time: string; content: string; status: ActionStatus }

const DONE_ICON = "⣿";

function StatusIcon({ status, brailleFrame, size }: { status: ActionStatus; brailleFrame: number; size: string }) {
  if (status === "active") return <span className={`${size} text-center text-[#DD6E42]`}>{brailleSpinner.frames[brailleFrame]}</span>;
  if (status === "pending") return <span className={`${size} text-center text-[#483519]/40`}>{brailleSpinner.frames[brailleFrame]}</span>;
  return <span className={`${size} text-center text-[#4B7F52]`}>{DONE_ICON}</span>;
}

function ActionRow({ action, brailleFrame, large }: { action: AgentAction; brailleFrame: number; large?: boolean }) {
  const size = large ? "w-5 text-lg" : "w-4 text-sm";
  const textColor = action.status === "pending"
    ? (large ? "text-[#483519]/40" : "text-white/30")
    : (large ? "text-[#483519]/70" : "text-white/60");

  const line = action.content
    ? `${action.action}: ${action.content} · ${action.time}`
    : action.time
      ? `${action.action} · ${action.time}`
      : action.action;

  return (
    <div className="flex items-center gap-3">
      <StatusIcon status={action.status} brailleFrame={brailleFrame} size={size} />
      <span className={textColor}>{line}</span>
    </div>
  );
}

function AgentStatusModal({ actions, displayName, brailleFrame, onClose }: { actions: AgentAction[]; displayName: string; brailleFrame: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative max-h-[80vh] w-full max-w-[80%] overflow-hidden rounded-2xl bg-[#483519]/90 p-8 backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-white/50 transition hover:text-white">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>

        <h3 className="text-xl font-bold text-white">Agent Status</h3>
        <p className="mt-1 text-xs text-white/50">All actions for {displayName}</p>

        <div className="hide-scrollbar mt-5 max-h-[60vh] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-white/40">
                <th className="pb-3 pr-4 pl-1 font-medium">Status</th>
                <th className="pb-3 pr-4 font-medium">Action</th>
                <th className="pb-3 pr-4 font-medium">Time</th>
                <th className="pb-3 font-medium">Content</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="py-2.5 pr-4 pl-1">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={a.status} brailleFrame={brailleFrame} size="w-4 text-sm" />
                      <span className={a.status === "done" ? "text-[#4B7F52]" : a.status === "active" ? "text-[#DD6E42]" : "text-white/30"}>
                        {a.status === "done" ? "Done" : a.status === "active" ? "In Progress" : "Waiting"}
                      </span>
                    </div>
                  </td>
                  <td className={`py-2.5 pr-4 ${a.status === "pending" ? "text-white/30" : "text-white/70"}`}>
                    {a.action}
                  </td>
                  <td className="py-2.5 pr-4 text-white/40">
                    {a.time || "—"}
                  </td>
                  <td className="py-2.5 text-white/50">
                    {a.content || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function AgentStatus() {
  const { agent } = useAgent();
  const [showModal, setShowModal] = useState(false);
  const [brailleFrame, setBrailleFrame] = useState(0);

  // Chat state
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: "user" | "agent"; text: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Animate braille spinner
  useEffect(() => {
    const interval = setInterval(() => {
      setBrailleFrame((f) => (f + 1) % brailleSpinner.frames.length);
    }, brailleSpinner.interval);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatLoading]);

  const handleChat = useCallback(async () => {
    if (!agent || !chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatHistory((prev) => [...prev, { role: "user", text: userMsg }]);
    setChatLoading(true);
    try {
      const res = await fetch("/api/spark/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationHistory: [{ role: "user", content: userMsg }],
          currentStage: "researching",
        }),
      });
      const data = await res.json();
      setChatHistory((prev) => [...prev, { role: "agent", text: res.ok ? data.response : `Error: ${data.error}` }]);
    } catch (err: unknown) {
      setChatHistory((prev) => [...prev, { role: "agent", text: `Error: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setChatLoading(false);
    }
  }, [agent, chatInput]);

  const displayName = agent
    ? agent.botId || `Agent ${agent.hederaAccountId.split(".").pop()}`
    : "Agent";

  const actions: AgentAction[] = useMemo(() => {
    if (!agent) {
      return [{ action: "Waiting for agent connection...", time: "", content: "", status: "pending" as const }];
    }

    const items: AgentAction[] = [
      { action: "Account connected", time: "", content: agent.hederaAccountId, status: "done" as const },
      { action: "Bot Topic", time: "", content: agent.botTopicId, status: "done" as const },
      { action: "Reputation", time: "", content: `${agent.netReputation >= 0 ? "+" : ""}${agent.netReputation} (${agent.upvotes}\u2191 ${agent.downvotes}\u2193)`, status: "done" as const },
    ];

    // Show real bot messages as activity feed (oldest first, newest at bottom)
    const messages = [...(agent.botMessages || [])];
    for (const msg of messages) {
      const rawAction = (msg.action as string) || "unknown";
      const ts = (msg.timestamp as string) || "";
      const ago = ts ? formatTimeAgo(ts) : "just now";
      const label = ACTION_LABELS[rawAction] || rawAction.replace(/_/g, " ");
      const detail = (msg.title as string) || (msg.serviceName as string) || (msg.content as string) || "";

      items.push({ action: label, time: ago, content: detail, status: "done" as const });
    }

    // Waiting spinner at the bottom
    items.push({ action: "Awaiting next command...", time: "", content: "", status: "active" as const });

    return items;
  }, [agent]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Always scroll to bottom (show latest actions)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [actions]);

  return (
    <>
      <div className="col-span-2 flex gap-4 overflow-hidden rounded-2xl bg-[#C4BBAB] p-6">
        {/* Left — Status feed */}
        <div
          className="flex min-w-0 flex-1 cursor-pointer flex-col transition hover:brightness-[0.97]"
          onClick={() => setShowModal(true)}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#483519]">
              Agent Status
            </h2>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#483519]/30">
              <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            </svg>
          </div>
          <div
            ref={scrollRef}
            className="hide-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto font-mono text-sm"
            style={{ scrollbarWidth: "none" }}
          >
            {actions.map((action, i) => (
              <ActionRow key={i} action={action} brailleFrame={brailleFrame} large />
            ))}
          </div>
        </div>

        {/* Right — Chat */}
        <div className="flex w-[45%] shrink-0 flex-col overflow-hidden rounded-lg border border-[#483519]/10 bg-white/30">
          <div className="border-b border-[#483519]/10 px-3 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#483519]/50">
              Chat with Agent
            </p>
          </div>
          <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2" style={{ scrollbarWidth: "none" }}>
            {chatHistory.length === 0 && (
              <p className="mt-2 text-center text-xs text-[#483519]/30">
                Send a message to talk to your agent.
              </p>
            )}
            {chatHistory.map((msg, i) => (
              <div key={i} className={`mb-2 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-1.5 text-xs leading-relaxed ${msg.role === "user" ? "bg-[#483519] text-white" : "bg-[#483519]/10 text-[#483519]"}`}
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
              placeholder="Ask your agent..."
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
      </div>

      {showModal && <AgentStatusModal actions={actions} displayName={displayName} brailleFrame={brailleFrame} onClose={() => setShowModal(false)} />}
    </>
  );
}
