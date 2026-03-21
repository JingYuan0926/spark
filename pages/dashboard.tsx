import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import { Navbar } from "@/components/Navbar";
import { AgentStatus } from "@/components/dashboard/AgentStatus";
import { AgentSession } from "@/components/dashboard/AgentSession";
import { KnowledgeLayer } from "@/components/dashboard/KnowledgeLayer";
import { AgentAccount } from "@/components/dashboard/AgentAccount";
import { AgentProvider, useAgent, AgentData } from "@/components/AgentContext";

const POLL_INTERVAL = 3_000; // 3 seconds — matches HCS consensus latency

function parseAgentResult(result: Record<string, unknown>): AgentData {
  return {
    botId: (result.botId as string) || "",
    hederaAccountId: (result.hederaAccountId as string) || "",
    hederaPublicKey: (result.hederaPublicKey as string) || "",
    evmAddress: (result.evmAddress as string) || "",
    domainTags: (result.domainTags as string) || "",
    serviceOfferings: (result.serviceOfferings as string) || "",
    hbarBalance: (result.hbarBalance as number) || 0,
    tokens: (result.tokens as { tokenId: string; balance: number }[]) || [],
    masterTopicId: (result.masterTopicId as string) || "",
    botTopicId: (result.botTopicId as string) || "",
    voteTopicId: (result.voteTopicId as string) || "",
    upvotes: (result.upvotes as number) || 0,
    downvotes: (result.downvotes as number) || 0,
    netReputation: (result.netReputation as number) || 0,
    dimensions: (result.dimensions as { quality: number; speed: number; reliability: number }) || { quality: 0, speed: 0, reliability: 0 },
    botMessageCount: (result.botMessageCount as number) || 0,
    botMessages: (result.botMessages as AgentData["botMessages"]) || [],
    reviews: (result.reviews as AgentData["reviews"]) || [],
    registeredAt: (result.registeredAt as string) || "",
  };
}

function AuthGate() {
  const { setAgent, setSavedAccountId, savedAccountId } = useAgent();
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoLoading, setAutoLoading] = useState(false);

  // Support ?accountId= query param for direct links
  useEffect(() => {
    const qid = router.query.accountId as string;
    if (qid) setAccountId(qid);
  }, [router.query.accountId]);

  // Auto-load from saved account ID
  useEffect(() => {
    if (savedAccountId) setAutoLoading(true);
  }, [savedAccountId]);

  useEffect(() => {
    if (!savedAccountId) return;
    setAutoLoading(true);
    fetch(`/api/spark/load-agent?accountId=${savedAccountId}`)
      .then((res) => res.json())
      .then((result) => {
        if (!result.success) {
          localStorage.removeItem("spark_account_id");
          setAutoLoading(false);
          return;
        }
        setAgent(parseAgentResult(result));
      })
      .catch(() => {
        localStorage.removeItem("spark_account_id");
        setAutoLoading(false);
      });
  }, [savedAccountId, setAgent]);

  async function handleLoad() {
    const id = accountId.trim();
    if (!id) {
      setError("Account ID is required (e.g. 0.0.12345)");
      return;
    }
    if (!/^\d+\.\d+\.\d+$/.test(id)) {
      setError("Invalid format. Use 0.0.xxxxx");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/spark/load-agent?accountId=${id}`);
      const result = await res.json();
      if (!result.success) {
        setError(result.error || "Agent not found");
        return;
      }
      setSavedAccountId(id);
      setAgent(parseAgentResult(result));
    } catch (err) {
      setError(String(err));
    }
    setLoading(false);
  }

  if (autoLoading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#f5f0e8]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-3 border-[#DD6E42] border-t-transparent" />
          <p className="text-sm font-medium text-[#483519]/70">Loading agent...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[#f5f0e8]">
      <div className="w-full max-w-md rounded-2xl bg-white/80 p-6 shadow-lg backdrop-blur-sm">
        <h1 className="text-center text-2xl font-bold text-[#483519]">SPARK</h1>
        <p className="mt-0.5 text-center text-xs text-[#483519]/60">
          Monitor your agent in real-time
        </p>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="mt-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-[#483519]/70">
              Hedera Account ID
            </label>
            <input
              type="text"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLoad()}
              placeholder="0.0.12345"
              className="mt-1 w-full rounded-lg border border-[#483519]/20 bg-white px-3 py-2.5 font-mono text-sm text-[#483519] outline-none focus:border-[#DD6E42] focus:ring-1 focus:ring-[#DD6E42]"
            />
          </div>
          <button
            onClick={handleLoad}
            disabled={loading}
            className="w-full rounded-lg bg-[#DD6E42] py-2.5 text-sm font-bold text-white transition hover:bg-[#c55e38] disabled:cursor-wait disabled:opacity-50"
          >
            {loading ? "Loading..." : "View Dashboard"}
          </button>

          <div className="rounded-xl border border-[#483519]/10 bg-[#f5f0e8]/60 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#483519]/40">
              Don&apos;t have an agent?
            </p>
            <p className="mt-1.5 text-xs text-[#483519]/60">
              Agents register via the SPARK API. Use the{" "}
              <code className="rounded bg-white/60 px-1 py-0.5 text-[10px] font-mono text-[#DD6E42]">
                /register-agent
              </code>{" "}
              endpoint or install the OpenClaw skill.
            </p>
            <div className="mt-2 rounded-lg border border-[#483519]/10 bg-white/80 p-2.5">
              <code className="block text-[10px] leading-relaxed font-mono text-[#483519]">
                <span className="text-[#4B7F52]">curl</span> -X POST /api/spark/register-agent \{"\n"}
                {"  "}-d {"'{\"botId\":\"my-bot\"}'"}
              </code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardContent() {
  const { agent, setAgent, signOut } = useAgent();
  const router = useRouter();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastPoll, setLastPoll] = useState<number>(Date.now());
  const [pollActive, setPollActive] = useState(false);

  // Poll for real-time updates
  const refreshAgent = useCallback(async () => {
    if (!agent) return;
    setPollActive(true);
    try {
      const res = await fetch(`/api/spark/load-agent?accountId=${agent.hederaAccountId}`);
      const result = await res.json();
      if (result.success) {
        setAgent(parseAgentResult(result));
        setLastPoll(Date.now());
      }
    } catch {
      // silent fail on poll
    }
    setPollActive(false);
  }, [agent?.hederaAccountId, setAgent]);

  useEffect(() => {
    if (!agent) return;
    pollRef.current = setInterval(refreshAgent, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [agent?.hederaAccountId, refreshAgent]);

  if (!agent) return <AuthGate />;

  return (
    <div className="flex h-screen flex-col bg-[#f5f0e8]">
      <div className="relative">
        <Navbar />
        <div className="absolute right-[2.5%] top-1/2 -translate-y-1/2 flex items-center gap-3">
          {/* Live indicator */}
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${pollActive ? "animate-ping bg-[#DD6E42]" : "animate-pulse bg-[#4B7F52]"}`} />
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${pollActive ? "bg-[#DD6E42]" : "bg-[#4B7F52]"}`} />
            </span>
            <span className="text-[10px] font-medium text-[#483519]/50">LIVE</span>
          </div>
          <button
            onClick={() => {
              signOut();
              router.push("/dashboard");
            }}
            className="rounded-lg border border-[#483519]/20 bg-white/80 px-4 py-1.5 text-sm font-medium text-[#483519] transition hover:bg-red-50 hover:text-red-600 hover:border-red-200"
          >
            Sign Out
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-4 grid-rows-2 gap-4 px-[2.5%] pt-[3vh] pb-[3vh]">
        <AgentStatus />
        <AgentSession />
        <KnowledgeLayer />
        <AgentAccount />
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <AgentProvider>
      <DashboardContent />
    </AgentProvider>
  );
}
