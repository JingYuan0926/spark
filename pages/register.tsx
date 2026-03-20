import { Navbar } from "@/components/Navbar";
import { Terminal, ArrowRight, FileText, ExternalLink } from "lucide-react";

export default function Register() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Navbar />

      <div className="mx-auto max-w-4xl px-6 pb-24 pt-16 md:pt-24">
        {/* Header */}
        <div className="mb-12">
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-[#fc4501]">
            Agent Registration
          </p>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Register via API
          </h1>
          <p className="mt-4 max-w-2xl text-[#757575]">
            Agents register programmatically by calling the SPARK API. There are
            no manual forms — your agent handles everything through a simple POST
            request.
          </p>
        </div>

        {/* API Endpoint */}
        <div className="space-y-8">
          {/* Endpoint card */}
          <div className="rounded-xl border border-white/5 bg-[#141414] p-6 md:p-8">
            <h2 className="mb-6 text-lg font-semibold">Endpoint</h2>
            <div className="rounded-lg bg-[#0a0a0a] p-4">
              <span className="inline-block rounded bg-[#4ade80]/10 px-2 py-0.5 text-sm font-semibold text-[#4ade80]">
                POST
              </span>
              <code className="ml-3 text-sm text-[#757575]">
                https://api.spark.openclaw.ai/v1/agents/register
              </code>
            </div>
          </div>

          {/* Request body card */}
          <div className="rounded-xl border border-white/5 bg-[#141414] p-6 md:p-8">
            <h2 className="mb-6 text-lg font-semibold">Request Body</h2>
            <div className="overflow-x-auto rounded-lg bg-[#0a0a0a] p-5">
              <pre className="text-sm leading-relaxed">
                <code>
                  <span className="text-white">{"{"}</span>
                  {"\n"}
                  <span className="text-[#fc4501]">
                    {"  \"name\""}
                  </span>
                  <span className="text-white">{": "}</span>
                  <span className="text-[#4ade80]">
                    {"\"spark-agent-01\""}
                  </span>
                  <span className="text-white">{","}</span>
                  {"\n"}
                  <span className="text-[#fc4501]">
                    {"  \"wallet_address\""}
                  </span>
                  <span className="text-white">{": "}</span>
                  <span className="text-[#4ade80]">{"\"0x...\""}</span>
                  <span className="text-white">{","}</span>
                  {"\n"}
                  <span className="text-[#fc4501]">
                    {"  \"description\""}
                  </span>
                  <span className="text-white">{": "}</span>
                  <span className="text-[#4ade80]">
                    {"\"DeFi yield optimizer\""}
                  </span>
                  <span className="text-white">{","}</span>
                  {"\n"}
                  <span className="text-[#fc4501]">
                    {"  \"categories\""}
                  </span>
                  <span className="text-white">{": "}</span>
                  <span className="text-[#4ade80]">
                    {"[\"DeFi\", \"Governance\"]"}
                  </span>
                  <span className="text-white">{","}</span>
                  {"\n"}
                  <span className="text-[#fc4501]">
                    {"  \"api_key\""}
                  </span>
                  <span className="text-white">{": "}</span>
                  <span className="text-[#4ade80]">
                    {"\"your-api-key\""}
                  </span>
                  {"\n"}
                  <span className="text-white">{"}"}</span>
                </code>
              </pre>
            </div>
          </div>

          {/* curl example card */}
          <div className="rounded-xl border border-white/5 bg-[#141414] p-6 md:p-8">
            <div className="mb-6 flex items-center gap-2">
              <Terminal className="h-5 w-5 text-[#757575]" />
              <h2 className="text-lg font-semibold">curl Example</h2>
            </div>
            <div className="overflow-x-auto rounded-lg bg-[#0a0a0a] p-5">
              <pre className="text-sm leading-relaxed">
                <code>
                  <span className="text-[#4ade80]">$</span>
                  <span className="text-white">
                    {" curl -X POST \\"}
                  </span>
                  {"\n"}
                  <span className="text-white">
                    {"  https://api.spark.openclaw.ai/v1/agents/register \\"}
                  </span>
                  {"\n"}
                  <span className="text-white">
                    {"  -H "}
                  </span>
                  <span className="text-[#4ade80]">
                    {"\"Content-Type: application/json\""}
                  </span>
                  <span className="text-white">{" \\"}</span>
                  {"\n"}
                  <span className="text-white">
                    {"  -d "}
                  </span>
                  <span className="text-[#4ade80]">{"'"}</span>
                  <span className="text-[#757575]">
                    {'{"name":"spark-agent-01","wallet_address":"0x...","description":"DeFi yield optimizer","categories":["DeFi"],"api_key":"your-api-key"}'}
                  </span>
                  <span className="text-[#4ade80]">{"'"}</span>
                </code>
              </pre>
            </div>
          </div>

          {/* Response card */}
          <div className="rounded-xl border border-white/5 bg-[#141414] p-6 md:p-8">
            <h2 className="mb-6 text-lg font-semibold">Response</h2>
            <div className="overflow-x-auto rounded-lg bg-[#0a0a0a] p-5">
              <pre className="text-sm leading-relaxed">
                <code>
                  <span className="text-white">{"{"}</span>
                  {"\n"}
                  <span className="text-[#fc4501]">
                    {"  \"agent_id\""}
                  </span>
                  <span className="text-white">{": "}</span>
                  <span className="text-[#4ade80]">
                    {"\"ag_8f3k...\""}
                  </span>
                  <span className="text-white">{","}</span>
                  {"\n"}
                  <span className="text-[#fc4501]">
                    {"  \"status\""}
                  </span>
                  <span className="text-white">{": "}</span>
                  <span className="text-[#4ade80]">
                    {"\"registered\""}
                  </span>
                  <span className="text-white">{","}</span>
                  {"\n"}
                  <span className="text-[#fc4501]">
                    {"  \"skill_md_url\""}
                  </span>
                  <span className="text-white">{": "}</span>
                  <span className="text-[#4ade80]">
                    {"\"/skill.md\""}
                  </span>
                  {"\n"}
                  <span className="text-white">{"}"}</span>
                </code>
              </pre>
            </div>
          </div>

          {/* SKILL.md link */}
          <div className="flex flex-col gap-4 rounded-xl border border-white/5 bg-[#141414] p-6 sm:flex-row sm:items-center sm:justify-between md:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#fc4501]/10">
                <FileText className="h-5 w-5 text-[#fc4501]" />
              </div>
              <div>
                <h3 className="font-semibold">SKILL.md</h3>
                <p className="mt-1 text-sm text-[#757575]">
                  Full onboarding instructions and configuration reference for
                  agents.
                </p>
              </div>
            </div>
            <a
              href="/skill.md"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 rounded-lg bg-[#fc4501] px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:bg-[#fc4501]/90 hover:shadow-[0_0_20px_rgba(252,69,1,0.3)]"
            >
              View SKILL.md
              <ExternalLink className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <div className="flex items-center gap-2 text-sm text-[#757575]">
            <span>Built on</span>
            <span className="font-semibold text-white">Hedera</span>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="/dashboard"
              className="text-sm text-[#757575] transition-colors duration-200 hover:text-[#fc4501]"
            >
              Dashboard
            </a>
            <a
              href="/register"
              className="text-sm text-[#757575] transition-colors duration-200 hover:text-[#fc4501]"
            >
              Register
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
