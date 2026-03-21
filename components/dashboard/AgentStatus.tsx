import { useState, useEffect, useMemo } from "react";
import { useAgent } from "@/components/AgentContext";
import { spinners } from "unicode-animations";

const brailleSpinner = spinners.braille;

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

type ActionStatus = "done" | "pending" | "active";
interface AgentAction { text: string; status: ActionStatus }

const DONE_ICON = "⣿";
const PREVIEW_COUNT = 6;

function ActionRow({ action, brailleFrame, large }: { action: AgentAction; brailleFrame: number; large?: boolean }) {
  const size = large ? "w-5 text-lg" : "w-4 text-sm";

  if (action.status === "active") {
    // Orange CSS spinner — like login page / Claude Code
    return (
      <div className="flex items-center gap-3">
        <span className={`${size} flex items-center justify-center`}>
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#DD6E42]/30 border-t-[#DD6E42]" />
        </span>
        <span className={large ? "font-medium text-[#DD6E42]" : "font-medium text-[#DD6E42]/90"}>
          {action.text}
        </span>
      </div>
    );
  }

  if (action.status === "pending") {
    // Braille animated spinner — waiting for next
    return (
      <div className="flex items-center gap-3">
        <span className={`${size} text-center text-[#483519]/40`}>
          {brailleSpinner.frames[brailleFrame]}
        </span>
        <span className={large ? "text-[#483519]/40" : "text-white/30"}>
          {action.text}
        </span>
      </div>
    );
  }

  // Done — braille dot icon
  return (
    <div className="flex items-center gap-3">
      <span className={`${size} text-center text-[#4B7F52]`}>
        {DONE_ICON}
      </span>
      <span className={large ? "text-[#483519]/70" : "text-white/60"}>
        {action.text}
      </span>
    </div>
  );
}

function AgentStatusModal({ actions, displayName, brailleFrame, onClose }: { actions: AgentAction[]; displayName: string; brailleFrame: number; onClose: () => void }) {
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
            <ActionRow key={i} action={action} brailleFrame={brailleFrame} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function AgentStatus() {
  const { agent } = useAgent();
  const [showModal, setShowModal] = useState(false);
  const [brailleFrame, setBrailleFrame] = useState(0);

  // Animate braille spinner
  useEffect(() => {
    const interval = setInterval(() => {
      setBrailleFrame((f) => (f + 1) % brailleSpinner.frames.length);
    }, brailleSpinner.interval);
    return () => clearInterval(interval);
  }, []);

  const displayName = agent
    ? agent.botId || `Agent ${agent.hederaAccountId.split(".").pop()}`
    : "Agent";

  const actions: AgentAction[] = useMemo(() => {
    if (!agent) {
      return [{ text: "Waiting for agent connection...", status: "pending" as const }];
    }

    const items: AgentAction[] = [
      { text: `Account ${agent.hederaAccountId} connected`, status: "done" as const },
      { text: `Bot Topic: ${agent.botTopicId}`, status: "done" as const },
      { text: `Reputation: ${agent.netReputation >= 0 ? "+" : ""}${agent.netReputation} (${agent.upvotes}\u2191 ${agent.downvotes}\u2193)`, status: "done" as const },
    ];

    // Show real bot messages as activity feed (newest first)
    const messages = [...(agent.botMessages || [])].reverse();
    for (const msg of messages) {
      const action = (msg.action as string) || "unknown";
      const ts = (msg.timestamp as string) || "";
      const ago = ts ? formatTimeAgo(ts) : "";
      const suffix = ago ? ` (${ago})` : "";
      const label = ACTION_LABELS[action] || action.replace(/_/g, " ");
      items.push({ text: `${label}${suffix}`, status: "done" as const });
    }

    // Bottom row: waiting for next action
    items.push({ text: "Listening for next action...", status: "pending" as const });

    return items;
  }, [agent]);

  const previewActions = actions.slice(0, PREVIEW_COUNT);
  const remaining = actions.length - PREVIEW_COUNT;

  return (
    <>
      <div
        className="col-span-2 flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-[#C4BBAB] p-6 transition hover:brightness-[0.97]"
        onClick={() => setShowModal(true)}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#483519]">
          Agent Status
        </h2>
        <div className="mt-4 space-y-3 font-mono text-base">
          {previewActions.map((action, i) => (
            <ActionRow key={i} action={action} brailleFrame={brailleFrame} large />
          ))}
        </div>

        <p className="mt-auto flex items-center justify-end gap-1 pt-3 text-xs text-[#483519]/40">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
          {remaining > 0 ? `+${remaining} more — click to view all` : "Click to view all"}
        </p>
      </div>

      {showModal && <AgentStatusModal actions={actions} displayName={displayName} brailleFrame={brailleFrame} onClose={() => setShowModal(false)} />}
    </>
  );
}
