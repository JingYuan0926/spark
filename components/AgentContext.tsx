import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface BotMessage {
  action?: string;
  timestamp?: string;
  sequenceNumber?: number;
  [key: string]: unknown;
}

export interface Review {
  voter: string;
  review: string;
  tags: string[];
  value: number;
  timestamp: string;
}

export interface AgentData {
  // Identity
  botId: string;
  hederaAccountId: string;
  hederaPublicKey: string;
  evmAddress: string;

  // Capabilities
  domainTags: string;
  serviceOfferings: string;

  // Balances
  hbarBalance: number;
  tokens: { tokenId: string; balance: number }[];

  // Topics
  masterTopicId: string;
  botTopicId: string;
  voteTopicId: string;

  // Reputation
  upvotes: number;
  downvotes: number;
  netReputation: number;
  dimensions: { quality: number; speed: number; reliability: number };

  // Activity
  botMessageCount: number;
  botMessages: BotMessage[];
  reviews: Review[];
  registeredAt: string;
}

const STORAGE_KEY = "spark_account_id";

interface AgentContextValue {
  agent: AgentData | null;
  setAgent: (agent: AgentData | null) => void;
  savedAccountId: string | null;
  setSavedAccountId: (id: string) => void;
  signOut: () => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

function getSavedAccountId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const [agent, setAgent] = useState<AgentData | null>(null);

  const setSavedAccountId = useCallback((id: string) => {
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    }
  }, []);

  const signOut = useCallback(() => {
    setAgent(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const savedAccountId = getSavedAccountId();

  return (
    <AgentContext.Provider value={{ agent, setAgent, savedAccountId, setSavedAccountId, signOut }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent must be used within AgentProvider");
  return ctx;
}
