import { useState, useCallback, useEffect, useRef } from "react";
import { useAgent, AgentData } from "@/contexts/AgentContext";

function formatHbar(value: number): string {
  if (value === 0) return "0";
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

function shortAddr(addr: string): string {
  if (!addr || addr === "0x0000000000000000000000000000000000000000") return "—";
  return addr.slice(0, 8) + "..." + addr.slice(-6);
}

function formatUsdc(raw: string | number): string {
  return (Number(raw) / 1e6).toFixed(2) + " USDC";
}

function ExplorerLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="ml-2 inline-flex shrink-0 items-center rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-medium text-[#DD6E42]/70 transition hover:bg-[#DD6E42]/15 hover:text-[#DD6E42]"
      title="View on explorer"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
      view
    </a>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="ml-2 inline-flex shrink-0 items-center rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-medium text-white/50 transition hover:bg-white/10 hover:text-white/80"
      title="Copy to clipboard"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

function truncate(str: string, front = 16, back = 8): string {
  if (!str) return "—";
  if (str.length <= front + back + 3) return str;
  return `${str.slice(0, front)}...${str.slice(-back)}`;
}

const STATUS_COLORS: Record<number, { bg: string; border: string; text: string; label: string }> = {
  0: { bg: "#f8fafc", border: "#e2e8f0", text: "#64748b", label: "None" },
  1: { bg: "#fffbeb", border: "#fcd34d", text: "#92400e", label: "Pending" },
  2: { bg: "#f0fdf4", border: "#86efac", text: "#166534", label: "Executed" },
  3: { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b", label: "Failed" },
  4: { bg: "#f8fafc", border: "#cbd5e1", text: "#64748b", label: "Cancelled" },
};

interface PayoutAgent {
  idx: number; address: string; name: string; amount: string;
  interval: number; status: number; active: boolean;
  totalPaid: string; payments: number;
}

interface HistoryEntry {
  agentIdx: number; scheduleAddress: string; scheduledTime: number;
  createdAt: number; executedAt: number; status: number;
}

// ── Dollar SVG Icon (minimalist) ──
function DollarIcon({ size = 16 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function StarIcon({ size = 16 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

const VAULT_ADDRESS = "0xdB818b1ED798acD53ab9D15960257b35A05AB44E";

const PREMIUM_PLANS = [
  { name: "Basic", hbar: "5", interval: 2592000, label: "5 HBAR / month", features: ["Priority chat responses", "Basic analytics"] },
  { name: "Pro", hbar: "15", interval: 2592000, label: "15 HBAR / month", features: ["Priority chat responses", "Advanced analytics", "Custom training", "API access"] },
  { name: "Enterprise", hbar: "50", interval: 2592000, label: "50 HBAR / month", features: ["Everything in Pro", "Dedicated compute", "Unlimited training", "Priority support"] },
];

// ── Premium Subscription Modal ──
function PremiumModal({
  onClose,
  agentName,
}: {
  onClose: () => void;
  agentName: string;
}) {
  const [subscribing, setSubscribing] = useState(false);
  const [subResult, setSubResult] = useState<{ success: boolean; message?: string; error?: string; txHash?: string } | null>(null);
  const [activeSubs, setActiveSubs] = useState<{ name: string; status: string; totalPaid: string; paymentCount: number; active: boolean }[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(true);

  // Load existing subscriptions
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/subscription/status?vaultAddress=${VAULT_ADDRESS}`);
        const data = await res.json();
        if (data.success && data.subscriptions) {
          setActiveSubs(data.subscriptions);
        }
      } catch { /* ignore */ }
      setLoadingSubs(false);
    })();
  }, []);

  async function handleSubscribe(plan: typeof PREMIUM_PLANS[0]) {
    setSubscribing(true);
    setSubResult(null);
    try {
      const res = await fetch("/api/subscription/subscribe-hbar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${agentName} — ${plan.name} Premium`,
          amountPerPeriod: plan.hbar,
          intervalSeconds: plan.interval,
          deposit: plan.hbar,
          vaultAddress: VAULT_ADDRESS,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSubResult({ success: true, message: `Subscribed to ${plan.name}!`, txHash: data.txHash });
        // Refresh subs
        const refresh = await fetch(`/api/subscription/status?vaultAddress=${VAULT_ADDRESS}`);
        const refreshData = await refresh.json();
        if (refreshData.success) setActiveSubs(refreshData.subscriptions);
      } else {
        setSubResult({ success: false, error: data.error });
      }
    } catch (err) {
      setSubResult({ success: false, error: String(err) });
    }
    setSubscribing(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-[700px] max-h-[80vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ fontFamily: "monospace" }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Premium Subscriptions</h2>
            <p className="text-xs text-gray-500 mt-0.5">Automated HBAR payments via Hedera Scheduled Transactions</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
        </div>

        {/* Result banner */}
        {subResult && (
          <div
            style={{
              marginBottom: 12, padding: 10, borderRadius: 8, fontSize: 12,
              background: subResult.success ? "#f0fdf4" : "#fef2f2",
              border: `1px solid ${subResult.success ? "#86efac" : "#fca5a5"}`,
              color: subResult.success ? "#166534" : "#991b1b",
            }}
          >
            {subResult.success ? (
              <>
                {subResult.message}
                {subResult.txHash && (
                  <a
                    href={`https://hashscan.io/testnet/transaction/${subResult.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#2563eb", marginLeft: 6, textDecoration: "underline" }}
                  >
                    View Tx
                  </a>
                )}
              </>
            ) : (
              `Error: ${subResult.error}`
            )}
          </div>
        )}

        {/* Active subscriptions */}
        <div>
          <h3 className="text-xs font-bold mb-2 text-gray-700">
            Active Subscriptions {loadingSubs && <span className="text-gray-400 font-normal">(loading...)</span>}
          </h3>
          {!loadingSubs && activeSubs.length === 0 && (
            <p className="text-xs text-gray-400">No subscriptions yet</p>
          )}
          {activeSubs.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                  <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Plan</th>
                  <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Status</th>
                  <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Payments</th>
                  <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Total Paid</th>
                </tr>
              </thead>
              <tbody>
                {activeSubs.map((s, i) => (
                  <tr key={i}>
                    <td style={{ padding: 6, border: "1px solid #e2e8f0", fontWeight: "bold" }}>{s.name}</td>
                    <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>
                      <span
                        style={{
                          padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: "bold",
                          background: s.active ? "#f0fdf4" : "#f8fafc",
                          border: `1px solid ${s.active ? "#86efac" : "#e2e8f0"}`,
                          color: s.active ? "#166534" : "#64748b",
                        }}
                      >
                        {s.active ? "Active" : s.status}
                      </span>
                    </td>
                    <td style={{ padding: 6, border: "1px solid #e2e8f0", textAlign: "center" }}>{s.paymentCount}</td>
                    <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>{(Number(s.totalPaid) / 1e8).toFixed(2)} HBAR</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Payout History Modal ──
function PayoutHistoryModal({
  onClose,
  agents,
  history,
  loading,
  onClaim,
  claiming,
  claimResult,
  onCancel,
  cancellingIdx,
  onRefresh,
}: {
  onClose: () => void;
  agents: PayoutAgent[];
  history: HistoryEntry[];
  loading: boolean;
  onClaim: () => void;
  claiming: boolean;
  claimResult: { success: boolean; message?: string; error?: string } | null;
  onCancel: (agentIdx: number) => void;
  cancellingIdx: number | null;
  onRefresh: () => void;
}) {
  const contributorIdxSet = new Set(agents.map((a) => a.idx));
  const totalEarned = agents.reduce((s, a) => s + Number(a.totalPaid), 0);
  const totalPayments = agents.reduce((s, a) => s + a.payments, 0);
  const activeCount = agents.filter((a) => a.status === 1).length;
  // Hide failed entries (status 3)
  const contributorHistory = history
    .filter((h) => contributorIdxSet.has(h.agentIdx))
    .filter((h) => h.status !== 3);

  // Auto-refresh every 10s
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    refreshRef.current = setInterval(onRefresh, 10000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [onRefresh]);

  const fmtTime = (epoch: number) => {
    if (!epoch) return "—";
    return new Date(epoch * 1000).toLocaleString();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-[700px] max-h-[80vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ fontFamily: "monospace" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold text-gray-900">Payout History &amp; Earnings</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onClaim}
              disabled={claiming}
              style={{
                padding: "6px 16px", fontSize: 12, fontWeight: "bold", borderRadius: 6,
                cursor: claiming ? "wait" : "pointer",
                background: claiming ? "#d1d5db" : "#16a34a", color: "#fff", border: "none",
              }}
            >
              {claiming ? "Claiming..." : "Claim Earnings"}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
          </div>
        </div>

        {/* Claim result */}
        {claimResult && (
          <div
            style={{
              marginBottom: 8, padding: 8, borderRadius: 6, fontSize: 11,
              background: claimResult.success ? "#f0fdf4" : "#fef2f2",
              border: `1px solid ${claimResult.success ? "#86efac" : "#fca5a5"}`,
              color: claimResult.success ? "#166534" : "#991b1b",
            }}
          >
            {claimResult.success ? claimResult.message : claimResult.error}
          </div>
        )}

        {loading ? (
          <p className="text-center text-gray-400 py-8">Loading...</p>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="text-center p-3 rounded-lg" style={{ background: "#f0fdf4", border: "1px solid #86efac" }}>
                <div className="text-xl font-bold" style={{ color: "#16a34a" }}>{(totalEarned / 1e6).toFixed(2)}</div>
                <div className="text-[10px]" style={{ color: "#166534" }}>Total Earned (USDC)</div>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ background: "#e0e7ff", border: "1px solid #a5b4fc" }}>
                <div className="text-xl font-bold" style={{ color: "#3730a3" }}>{totalPayments}</div>
                <div className="text-[10px]" style={{ color: "#4338ca" }}>Total Payments</div>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ background: "#fffbeb", border: "1px solid #fcd34d" }}>
                <div className="text-xl font-bold" style={{ color: "#92400e" }}>{activeCount}</div>
                <div className="text-[10px]" style={{ color: "#a16207" }}>Active Streams</div>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ background: "#fce7f3", border: "1px solid #f9a8d4" }}>
                <div className="text-xl font-bold" style={{ color: "#9d174d" }}>{agents.length}</div>
                <div className="text-[10px]" style={{ color: "#be185d" }}>Contributors</div>
              </div>
            </div>

            {/* Per-contributor earnings */}
            {agents.length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs font-bold mb-2 text-gray-700">Per-Contributor Earnings</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                      <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Name</th>
                      <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Address</th>
                      <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Rate</th>
                      <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Payments</th>
                      <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Total Earned</th>
                      <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Status</th>
                      <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((a) => {
                      const sc = STATUS_COLORS[a.status] || STATUS_COLORS[0];
                      return (
                        <tr key={a.idx}>
                          <td style={{ padding: 6, border: "1px solid #e2e8f0", fontWeight: "bold" }}>{a.name}</td>
                          <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>
                            <a href={`https://hashscan.io/testnet/account/0.0.7314364/operations?ps=1&p2=1&p3=1`} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", fontSize: 10 }}>
                              {shortAddr(a.address)}
                            </a>
                          </td>
                          <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>{formatUsdc(a.amount)} / {a.interval}s</td>
                          <td style={{ padding: 6, border: "1px solid #e2e8f0", textAlign: "center" }}>{a.payments}</td>
                          <td style={{ padding: 6, border: "1px solid #e2e8f0", fontWeight: "bold", color: "#16a34a" }}>{formatUsdc(a.totalPaid)}</td>
                          <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>
                            <span style={{ background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text, padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: "bold" }}>
                              {sc.label}
                            </span>
                          </td>
                          <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>
                            {a.active && a.status === 1 && (
                              <button
                                onClick={() => onCancel(a.idx)}
                                disabled={cancellingIdx === a.idx}
                                style={{
                                  fontSize: 10, cursor: cancellingIdx === a.idx ? "wait" : "pointer",
                                  padding: "3px 8px", background: "#fef2f2", color: "#dc2626",
                                  border: "1px solid #fca5a5", borderRadius: 3, fontWeight: "bold",
                                }}
                              >
                                {cancellingIdx === a.idx ? "..." : "Stop"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Execution history */}
            <h3 className="text-xs font-bold mb-2 text-gray-700">Execution History</h3>
            {contributorHistory.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                    <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Agent</th>
                    <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Schedule</th>
                    <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Scheduled For</th>
                    <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Executed</th>
                    <th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contributorHistory
                    .sort((a, b) => (b.executedAt || b.scheduledTime) - (a.executedAt || a.scheduledTime))
                    .map((h, i) => {
                      const sc = STATUS_COLORS[h.status] || STATUS_COLORS[0];
                      const agentName = agents.find((a) => a.idx === h.agentIdx)?.name || `#${h.agentIdx}`;
                      return (
                        <tr key={i}>
                          <td style={{ padding: 6, border: "1px solid #e2e8f0", fontWeight: "bold" }}>{agentName}</td>
                          <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>
                            <a href={`https://hashscan.io/testnet/contract/${h.scheduleAddress}`} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", fontSize: 10 }}>
                              {shortAddr(h.scheduleAddress)}
                            </a>
                          </td>
                          <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>{fmtTime(h.scheduledTime)}</td>
                          <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>{fmtTime(h.executedAt)}</td>
                          <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>
                            <span style={{ background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text, padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: "bold" }}>
                              {sc.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            ) : (
              <p className="text-gray-400 text-xs">No execution history yet.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Agent Details Modal ──
function AgentAccountModal({ onClose }: { onClose: () => void }) {
  const { agent, privateKey } = useAgent();
  const [showKey, setShowKey] = useState(false);

  if (!agent) return null;

  const usdcToken = agent.tokens.find((t) => t.tokenId === "0.0.7984944");
  const usdcBalance = usdcToken ? usdcToken.balance / 1e6 : 0;
  const hbar = formatHbar(agent.hbarBalance);
  const displayName = agent.botId || `Agent ${agent.hederaAccountId.split(".").pop()}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full max-w-[80%] overflow-y-auto rounded-3xl bg-[#483519]/50 p-10 backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-5 right-5 text-white/50 transition hover:text-white">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>

        <div className="text-base text-white/90">
          {/* Header */}
          <div className="flex items-center gap-4">
            <h3 className="text-3xl font-bold text-white">{displayName} — {agent.hederaAccountId}</h3>
            <span className="text-[#4B7F52]" title="Loaded">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            </span>
          </div>
          <p className="mt-2 text-sm text-white/50">
            {hbar} HBAR + {usdcBalance.toLocaleString()} USDC | {agent.botMessageCount} messages | Registered: {agent.registeredAt?.slice(0, 10) || "?"}
          </p>

          {/* 2-column grid */}
          <div className="mt-8 grid grid-cols-2 gap-x-12 gap-y-7">
            {/* Left col */}
            <div className="space-y-7">
              <div>
                <h4 className="text-sm font-bold uppercase tracking-wider text-[#DD6E42]">Token Balances</h4>
                <div className="mt-3 flex gap-8">
                  <div className="flex items-center gap-2.5">
                    <img src="/tokens/usdc.png" alt="USDC" className="h-7 w-7 rounded-full" />
                    <span className="text-lg font-bold">{usdcBalance.toLocaleString()} USDC</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <img src="/tokens/hbar.png" alt="HBAR" className="h-7 w-7 rounded-full" />
                    <span className="text-lg font-bold">{hbar} HBAR</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold uppercase tracking-wider text-[#DD6E42]">Agent Profile</h4>
                <div className="mt-3 space-y-1.5 text-base">
                  <p>Domain Tags: <span className="font-bold">{agent.domainTags || "—"}</span></p>
                  <p>Service Offerings: <span className="font-bold">{agent.serviceOfferings || "—"}</span></p>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold uppercase tracking-wider text-[#DD6E42]">HCS-20 Reputation</h4>
                <div className="mt-3 flex flex-wrap gap-6 text-base">
                  <p>Upvotes: <span className="font-bold text-[#4B7F52]">{agent.upvotes}</span></p>
                  <p>Downvotes: <span className="font-bold text-[#DD6E42]">{agent.downvotes}</span></p>
                  <p>Net: <span className="font-bold">{agent.netReputation}</span></p>
                  <p>Activity: <span className="font-bold">{agent.botMessageCount} messages</span></p>
                </div>
              </div>
            </div>

            {/* Right col */}
            <div className="space-y-7">
              <div>
                <h4 className="text-sm font-bold uppercase tracking-wider text-[#DD6E42]">Hedera Testnet</h4>
                <div className="mt-3 flex gap-8 text-lg">
                  <p>HBAR: <span className="font-bold">{hbar}</span></p>
                  <p>USDC: <span className="font-bold">{usdcBalance.toLocaleString()}</span></p>
                </div>
                <div className="mt-4 space-y-3.5 text-sm text-white/70">
                  <div className="flex items-center">
                    <span>Account:</span>
                    <span className="ml-2 font-mono font-semibold text-white/90">{agent.hederaAccountId}</span>
                    <CopyButton text={agent.hederaAccountId} />
                    <ExplorerLink href={`https://hashscan.io/testnet/account/${agent.hederaAccountId}`} />
                  </div>
                  <div className="flex items-center">
                    <span>EVM Address:</span>
                    <span className="ml-2 font-mono font-semibold text-white/90">{truncate(agent.evmAddress, 18, 6)}</span>
                    <CopyButton text={agent.evmAddress} />
                    <ExplorerLink href={`https://hashscan.io/testnet/account/${agent.hederaAccountId}`} />
                  </div>
                  <div>
                    <div className="flex items-center">
                      <span>Bot Topic <span className="text-white/40">(private diary)</span>:</span>
                      <span className="ml-2 font-mono font-semibold text-white/90">{agent.botTopicId}</span>
                      <CopyButton text={agent.botTopicId} />
                      <ExplorerLink href={`https://hashscan.io/testnet/topic/${agent.botTopicId}`} />
                    </div>
                    <p className="mt-0.5 text-xs text-white/35">(submit key = bot&apos;s key)</p>
                  </div>
                  <div>
                    <div className="flex items-center">
                      <span>Vote Topic <span className="text-white/40">(public HCS-20)</span>:</span>
                      <span className="ml-2 font-mono font-semibold text-white/90">{agent.voteTopicId}</span>
                      <CopyButton text={agent.voteTopicId} />
                      <ExplorerLink href={`https://hashscan.io/testnet/topic/${agent.voteTopicId}`} />
                    </div>
                    <p className="mt-0.5 text-xs text-white/35">(upvote + downvote deployed)</p>
                  </div>
                  <div>
                    <div className="flex items-center">
                      <span>Master Topic <span className="text-white/40">(shared ledger)</span>:</span>
                      <span className="ml-2 font-mono font-semibold text-white/90">{agent.masterTopicId}</span>
                      <CopyButton text={agent.masterTopicId} />
                      <ExplorerLink href={`https://hashscan.io/testnet/topic/${agent.masterTopicId}`} />
                    </div>
                    <p className="mt-0.5 text-xs text-white/35">(submit key = operator)</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Private Key Section */}
          <div className="mt-8 border-t border-white/10 pt-6">
            {!showKey ? (
              <button
                onClick={() => setShowKey(true)}
                className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-white/50 transition hover:bg-white/10 hover:text-white/80"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                Show Credentials (Private Key)
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold uppercase tracking-wider text-[#DD6E42]">Private Key</h4>
                  <button
                    onClick={() => setShowKey(false)}
                    className="text-xs text-white/40 transition hover:text-white/70"
                  >
                    Hide
                  </button>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-[#DD6E42]/30 bg-[#DD6E42]/10 p-4">
                  <p className="flex-1 break-all font-mono text-sm text-white/80">
                    {privateKey || "—"}
                  </p>
                  {privateKey && <CopyButton text={privateKey} />}
                </div>
                <p className="text-xs text-[#DD6E42]/60">
                  Never share this key — it controls your Hedera account, HBAR, and USDC.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Card ──
export function AgentAccount() {
  const { agent, setAgent, privateKey } = useAgent();
  const [showModal, setShowModal] = useState(false);
  const [showPremium, setShowPremium] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showPayout, setShowPayout] = useState(false);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutAgents, setPayoutAgents] = useState<PayoutAgent[]>([]);
  const [payoutHistory, setPayoutHistory] = useState<HistoryEntry[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const [cancellingIdx, setCancellingIdx] = useState<number | null>(null);

  const handleRefresh = useCallback(async () => {
    if (!privateKey || refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/spark/load-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hederaPrivateKey: privateKey }),
      });
      const data = await res.json();
      if (data.success) {
        setAgent(data as AgentData);
      }
    } catch { /* silently fail */ }
    setRefreshing(false);
  }, [privateKey, refreshing, setAgent]);

  // Silent refresh (no loading spinner, used for auto-refresh)
  const silentRefresh = useCallback(async () => {
    try {
      const [payoutRes, statusRes] = await Promise.all([
        fetch("/api/spark/payout"),
        fetch("/api/schedule/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vaultAddress: "0xdB818b1ED798acD53ab9D15960257b35A05AB44E" }),
        }),
      ]);
      const [payoutData, statusData] = await Promise.all([payoutRes.json(), statusRes.json()]);
      if (payoutData.success) setPayoutAgents(payoutData.agents);
      if (statusData.success) setPayoutHistory(statusData.history || []);
    } catch { /* silently fail */ }
  }, []);

  const handleOpenPayout = useCallback(async () => {
    setShowPayout(true);
    setPayoutLoading(true);
    try {
      // Fetch contributor agents
      const payoutRes = await fetch("/api/spark/payout");
      const payoutData = await payoutRes.json();
      if (payoutData.success) {
        setPayoutAgents(payoutData.agents);
      }
      // Fetch execution history
      const statusRes = await fetch("/api/schedule/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vaultAddress: "0xdB818b1ED798acD53ab9D15960257b35A05AB44E" }),
      });
      const statusData = await statusRes.json();
      if (statusData.success) {
        setPayoutHistory(statusData.history || []);
      }
    } catch { /* silently fail */ }
    setPayoutLoading(false);
  }, []);

  const handleClaim = useCallback(async () => {
    if (claiming || !agent) return;
    setClaiming(true);
    setClaimResult(null);
    try {
      const res = await fetch("/api/spark/payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evmAddress: agent.evmAddress }),
      });
      const result = await res.json();
      if (result.success) {
        setClaimResult({ success: true, message: result.message || `Payout ${result.action} for ${agent.evmAddress.slice(0, 10)}...` });
        // Refresh payout data
        handleOpenPayout();
      } else {
        setClaimResult({ success: false, error: result.error });
      }
    } catch (err) {
      setClaimResult({ success: false, error: String(err) });
    }
    setClaiming(false);
  }, [claiming, agent, handleOpenPayout]);

  const handleCancel = useCallback(async (agentIdx: number) => {
    setCancellingIdx(agentIdx);
    try {
      await fetch("/api/schedule/cancel-payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentIdx }),
      });
      // Refresh data after cancellation
      await silentRefresh();
    } catch { /* silently fail */ }
    setCancellingIdx(null);
  }, [silentRefresh]);

  if (!agent) return null;

  const usdcToken = agent.tokens.find((t) => t.tokenId === "0.0.7984944");
  const usdcBalance = usdcToken ? usdcToken.balance / 1e6 : 0;
  const hbar = formatHbar(agent.hbarBalance);
  const displayName = agent.botId || `Agent ${agent.hederaAccountId.split(".").pop()}`;

  return (
    <>
      <div
        className="flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-[#DD6E42]/50 p-6 transition hover:bg-[#DD6E42]/60"
        onClick={() => setShowModal(true)}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#7a3a1f]">
            Agent Account
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); setShowPremium(true); }}
              className="rounded-full p-1.5 transition text-[#7a3a1f]/50 hover:bg-[#7a3a1f]/10 hover:text-[#7a3a1f]"
              title="Subscription History"
            >
              <StarIcon size={16} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleOpenPayout(); }}
              className="rounded-full p-1.5 transition text-[#7a3a1f]/50 hover:bg-[#7a3a1f]/10 hover:text-[#7a3a1f]"
              title="Payout History & Earnings"
            >
              <DollarIcon size={16} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
              disabled={refreshing}
              className={`rounded-full p-1.5 transition ${refreshing ? "animate-spin text-[#7a3a1f]/40" : "text-[#7a3a1f]/50 hover:bg-[#7a3a1f]/10 hover:text-[#7a3a1f]"}`}
              title="Refresh balances"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {/* Agent ID + status icons */}
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold text-[#7a3a1f]">{displayName}</span>
            <span className="font-mono text-sm text-[#7a3a1f]/70">{agent.hederaAccountId}</span>
            <span className="text-[#4B7F52]" title="Loaded">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            </span>
          </div>

          {/* Token balances */}
          <div className="flex gap-6 text-lg">
            <div className="flex items-center gap-2">
              <img src="/tokens/usdc.png" alt="USDC" className="h-6 w-6 rounded-full" />
              <span className="font-bold text-[#7a3a1f]">{usdcBalance.toLocaleString()}</span>
              <span className="text-[#7a3a1f]/60">USDC</span>
            </div>
            <div className="flex items-center gap-2">
              <img src="/tokens/hbar.png" alt="HBAR" className="h-6 w-6 rounded-full" />
              <span className="font-bold text-[#7a3a1f]">{hbar}</span>
              <span className="text-[#7a3a1f]/60">HBAR</span>
            </div>
          </div>

          {/* Domain & Services */}
          <div className="space-y-1.5 text-base">
            <p className="text-[#7a3a1f]/70">Domain: <span className="font-semibold text-[#7a3a1f]">{agent.domainTags || "—"}</span></p>
            <p className="text-[#7a3a1f]/70">Services: <span className="font-semibold text-[#7a3a1f]">{agent.serviceOfferings || "—"}</span></p>
          </div>
        </div>

        {/* Click hint */}
        <p className="mt-auto flex items-center justify-end gap-1 pt-2 text-xs text-[#7a3a1f]/40">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
          Click to view full details
        </p>
      </div>

      {showModal && <AgentAccountModal onClose={() => setShowModal(false)} />}
      {showPremium && <PremiumModal onClose={() => setShowPremium(false)} agentName={displayName} />}
      {showPayout && (
        <PayoutHistoryModal
          onClose={() => setShowPayout(false)}
          agents={payoutAgents}
          history={payoutHistory}
          loading={payoutLoading}
          onClaim={handleClaim}
          claiming={claiming}
          claimResult={claimResult}
          onCancel={handleCancel}
          cancellingIdx={cancellingIdx}
          onRefresh={silentRefresh}
        />
      )}
    </>
  );
}
