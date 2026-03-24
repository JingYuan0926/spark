import { useState, useEffect, useCallback, useRef } from "react";
import { spinners } from "unicode-animations";
import { useRouter } from "next/router";
import { Navbar } from "@/components/Navbar";
import { AgentStatus } from "@/components/dashboard/AgentStatus";
import { AgentSession } from "@/components/dashboard/AgentSession";
import { KnowledgeLayer } from "@/components/dashboard/KnowledgeLayer";
import { AgentAccount } from "@/components/dashboard/AgentAccount";
import { HiringLayer } from "@/components/dashboard/HiringLayer";
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

  // Determine which account to auto-load: URL query param takes priority over localStorage
  const targetAccountId = (router.query.accountId as string) || savedAccountId;

  // Support ?accountId= query param for direct links
  useEffect(() => {
    const qid = router.query.accountId as string;
    if (qid) setAccountId(qid);
  }, [router.query.accountId]);

  // Auto-load from URL query param or saved account ID
  useEffect(() => {
    if (targetAccountId) setAutoLoading(true);
  }, [targetAccountId]);

  useEffect(() => {
    if (!targetAccountId) return;
    setAutoLoading(true);
    fetch(`/api/spark/load-agent?accountId=${targetAccountId}`)
      .then((res) => res.json())
      .then((result) => {
        if (!result.success) {
          if (!router.query.accountId) localStorage.removeItem("spark_account_id");
          setAutoLoading(false);
          return;
        }
        setSavedAccountId(targetAccountId);
        setAgent(parseAgentResult(result));
      })
      .catch(() => {
        if (!router.query.accountId) localStorage.removeItem("spark_account_id");
        setAutoLoading(false);
      });
  }, [targetAccountId, setAgent, setSavedAccountId, router.query.accountId]);

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

  const [spinFrame, setSpinFrame] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setSpinFrame((f) => (f + 1) % spinners.braille.frames.length), spinners.braille.interval);
    return () => clearInterval(iv);
  }, []);

  if (autoLoading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#f5f0e8]">
        <div className="flex flex-col items-center gap-6">
          <img src="/logo.png" alt="SPARK" className="h-14 animate-pulse" />
          <span className="text-4xl text-[#DD6E42]">{spinners.braille.frames[spinFrame]}</span>
          <p className="text-base font-medium text-[#483519]/70">Loading agent...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[#f5f0e8]">
      <div className="w-full max-w-lg rounded-2xl bg-white/80 p-10 shadow-lg backdrop-blur-sm">
        <div className="flex justify-center">
          <img src="/logo.png" alt="SPARK" className="h-14" />
        </div>
        <p className="mt-3 text-center text-base text-[#483519]/60">
          Monitor your agent in real-time
        </p>

        {error && (
          <div className="mt-5 rounded-lg bg-red-50 p-4 text-base text-red-600">
            {error}
          </div>
        )}

        <div className="mt-7 space-y-5">
          <div>
            <label className="text-sm font-medium text-[#483519]/70">
              Hedera Account ID
            </label>
            <input
              type="text"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLoad()}
              placeholder="0.0.12345"
              className="mt-2 w-full rounded-lg border border-[#483519]/20 bg-white px-4 py-3.5 font-mono text-base text-[#483519] outline-none focus:border-[#DD6E42] focus:ring-1 focus:ring-[#DD6E42]"
            />
          </div>
          <button
            onClick={handleLoad}
            disabled={loading}
            className="w-full rounded-lg bg-[#DD6E42] py-3.5 text-base font-bold text-white transition hover:bg-[#c55e38] disabled:cursor-wait disabled:opacity-50"
          >
            {loading ? "Loading..." : "View Dashboard"}
          </button>

          <div className="rounded-xl border border-[#483519]/10 bg-[#f5f0e8]/60 p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#483519]/40">
              Don&apos;t have an agent?
            </p>
            <p className="mt-2 text-sm text-[#483519]/60">
              Agents register via the SPARK API. Use the{" "}
              <code className="rounded bg-white/60 px-1.5 py-0.5 text-xs font-mono text-[#DD6E42]">
                /register-agent
              </code>{" "}
              endpoint or install the OpenClaw skill.
            </p>
            <div className="mt-3 rounded-lg border border-[#483519]/10 bg-white/80 p-3">
              <code className="block text-xs leading-relaxed font-mono text-[#483519]">
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
  const [view, setView] = useState<"dashboard" | "hiring">("dashboard");

  // Poll for updates
  const refreshAgent = useCallback(async () => {
    if (!agent) return;
    try {
      const res = await fetch(`/api/spark/load-agent?accountId=${agent.hederaAccountId}`);
      const result = await res.json();
      if (result.success) {
        setAgent(parseAgentResult(result));
      }
    } catch {
      // silent fail on poll
    }
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
      <Navbar onSignOut={() => { signOut(); router.push("/dashboard"); }}>
        <button
          onClick={() => setView("dashboard")}
          className={`px-4 py-1 text-sm font-semibold transition ${
            view === "dashboard"
              ? "text-[#483519]"
              : "text-[#483519]/40 hover:text-[#483519]"
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setView("hiring")}
          className={`px-4 py-1 text-sm font-semibold transition ${
            view === "hiring"
              ? "text-[#483519]"
              : "text-[#483519]/40 hover:text-[#483519]"
          }`}
        >
          Hiring
        </button>
      </Navbar>

      <div className={`grid min-h-0 flex-1 grid-cols-4 grid-rows-2 gap-6 px-[2.5%] pt-[3vh] pb-[3vh] ${view === "dashboard" ? "" : "hidden"}`}>
        <AgentStatus />
        <AgentSession />
        <KnowledgeLayer />
        <AgentAccount />
      </div>
      <div className={`flex min-h-0 flex-1 flex-col px-[2.5%] pt-[3vh] pb-[3vh] ${view === "hiring" ? "" : "hidden"}`}>
        <HiringLayer onBack={() => setView("dashboard")} />
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
