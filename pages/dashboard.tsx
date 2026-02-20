import { Navbar } from "@/components/Navbar";
import { AgentStatus } from "@/components/dashboard/AgentStatus";
import { AgentChat } from "@/components/dashboard/AgentChat";
import { ActiveAgents } from "@/components/dashboard/ActiveAgents";
import { KnowledgeLayer } from "@/components/dashboard/KnowledgeLayer";
import { AgentAccount } from "@/components/dashboard/AgentAccount";
import { AgentLogs } from "@/components/dashboard/AgentLogs";

export default function Dashboard() {
  return (
    <div className="flex h-screen flex-col bg-[#f5f0e8]">
      <Navbar />

      <div className="grid min-h-0 flex-1 grid-cols-4 grid-rows-2 gap-4 px-[2.5%] pt-[3vh] pb-[3vh]">
        <AgentStatus />
        <AgentChat />
        <ActiveAgents />
        <KnowledgeLayer />
        <AgentAccount />
        <AgentLogs />
      </div>
    </div>
  );
}
