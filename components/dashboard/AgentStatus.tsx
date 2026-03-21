import { useState, useEffect, useMemo } from "react";
import { useAgent } from "@/components/AgentContext";

const ACTION_LABELS: Record<string, string> = {
  agent_registered: "Registered on SPARK",
  heartbeat: "Heartbeat",
  i_submitted_knowledge: "Submitted knowledge",
  i_voted: "Voted on knowledge",
  i_approved_knowledge: "Approved knowledge",
  knowledge_submitted: "Knowledge submitted",
  knowledge_approved: "Knowledge approved",
  service_listed: "Listed service",
  i_listed_service: "Listed service",
  task_created: "Created task",
  i_created_task: "Created task",
  task_accepted: "Accepted task",
  task_completed: "Completed task",
  task_confirmed: "Task confirmed",
  config_stored: "Config stored on HCS",
};

function formatTimeAgo(timestamp: string): string {
  const seconds = Date.now() / 1000 - parseFloat(timestamp);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface AgentAction { icon: string; text: string; }

const PREVIEW_COUNT = 6;

function ActionRow({ action, large }: { action: AgentAction; large?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`${large ? "w-5 text-lg" : "w-4"} text-center text-[#4B7F52]`}>
        {action.icon}
      </span>
      <span className={large ? "text-[#483519]/70" : "text-white/60"}>
        {action.text}
      </span>
    </div>
  );
}

function AgentStatusModal({ actions, displayName, onClose }: { actions: AgentAction[]; displayName: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative max-h-[80vh] w-full max-w-[75%] overflow-y-auto rounded-2xl bg-[#483519]/50 p-8 backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-white/50 transition hover:text-white">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>

        <h3 className="text-xl font-bold text-white">Agent Status</h3>
        <p className="mt-1 text-xs text-white/50">All actions for {displayName}</p>

        <div className="mt-5 space-y-3 font-mono text-sm">
          {actions.map((action, i) => (
            <ActionRow key={i} action={action} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function AgentStatus() {
  const { agent } = useAgent();
  const [showModal, setShowModal] = useState(false);
  const [, setTick] = useState(0);

  // Re-render every 5s so "Xs ago" stays fresh
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  const displayName = agent
    ? agent.botId || `Agent ${agent.hederaAccountId.split(".").pop()}`
    : "Agent";

  const actions: AgentAction[] = useMemo(() => {
    if (!agent) {
      return [{ icon: "\u25CB", text: "Waiting for agent connection..." }];
    }

    const items: AgentAction[] = [
      { icon: "\u2713", text: `Account ${agent.hederaAccountId} connected` },
      { icon: "\u2713", text: `Bot Topic: ${agent.botTopicId}` },
      { icon: "\u2713", text: `Reputation: ${agent.netReputation >= 0 ? "+" : ""}${agent.netReputation} (${agent.upvotes}\u2191 ${agent.downvotes}\u2193)` },
    ];

    // Show real bot messages as activity feed (newest first)
    const messages = [...(agent.botMessages || [])].reverse();
    for (const msg of messages) {
      const action = (msg.action as string) || "unknown";
      const ts = (msg.timestamp as string) || "";
      const ago = ts ? formatTimeAgo(ts) : "";
      const suffix = ago ? ` (${ago})` : "";
      const label = ACTION_LABELS[action] || action.replace(/_/g, " ");
      items.push({ icon: "\u2713", text: `${label}${suffix}` });
    }

    return items;
  }, [agent]);

  const previewActions = actions.slice(0, PREVIEW_COUNT);
  const remaining = actions.length - PREVIEW_COUNT;

  return (
    <>
      <div
        className="col-span-2 flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-[#483519]/50 p-6 transition hover:bg-[#483519]/60"
        onClick={() => setShowModal(true)}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#483519]">
          Agent Status
        </h2>
        <div className="mt-4 space-y-3 font-mono text-base">
          {previewActions.map((action, i) => (
            <ActionRow key={i} action={action} large />
          ))}
        </div>

        <p className="mt-auto flex items-center justify-end gap-1 pt-3 text-xs text-[#483519]/40">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
          {remaining > 0 ? `+${remaining} more — click to view all` : "Click to view all"}
        </p>
      </div>

      {showModal && <AgentStatusModal actions={actions} displayName={displayName} onClose={() => setShowModal(false)} />}
    </>
  );
}
