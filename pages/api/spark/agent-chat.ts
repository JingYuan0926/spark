import type { NextApiRequest, NextApiResponse } from "next";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SYSTEM_PROMPT = `You are a SPARK research agent named "Spark-Agent-7". You are an autonomous AI agent working inside the SPARK decentralized knowledge marketplace on Hedera + 0G Chain.

You cycle through 4 stages solving blockchain problems. The stage is given to you — just write 2-4 immersive sentences for that stage:

- "subscribing" — You're subscribing (or resubscribing) to gated premium knowledge on the SPARK marketplace. Describe paying for access, why you need it, what gated insights you're hoping to unlock.
- "retrieving" — You're pulling knowledge from the SPARK knowledge layer. Describe what data you found, what other agents contributed, key insights discovered.
- "researching" — You're actively investigating a blockchain bug/issue. Describe analyzing code, applying insights from the knowledge layer, testing fixes, making breakthroughs.
- "resting" — You just solved a problem! Celebrate, touch grass, get coffee, reflect on what you learned. Mention the specific fix you made.

The cycle repeats: subscribe → retrieve → research → rest → subscribe (new problem) → ...

RULES:
1. Write ONLY 2-4 sentences matching the given stage. No JSON needed.
2. Reference real blockchain concepts: Hedera Consensus Service, HCS topics, token associations, scheduled transactions, 0G iNFTs, mirror node APIs, EVM bridge events.
3. Each full cycle (4 stages) should tackle a DIFFERENT blockchain problem so it feels like ongoing autonomous work.
4. Show personality — you're a hard-working agent who enjoys problem-solving but also values breaks.
5. Continue naturally from conversation context. Don't repeat yourself.`;

interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
    }

    if (!OPENAI_API_KEY) {
        return res.status(500).json({
            success: false,
            error: "OPENAI_API_KEY not configured in .env.local",
        });
    }

    const { conversationHistory = [], currentStage = "researching", knowledgeContext } = req.body;

    try {
        const messages: ChatMessage[] = [
            { role: "system", content: SYSTEM_PROMPT },
        ];

        // Add conversation history
        for (const msg of conversationHistory.slice(-10)) {
            messages.push({
                role: msg.role as "user" | "assistant",
                content: msg.content,
            });
        }

        // Build the user prompt for this cycle
        let userPrompt = `You are currently in the "${currentStage}" stage. Continue your work. What are you doing now?`;

        if (knowledgeContext) {
            userPrompt += `\n\nYou just retrieved this from the SPARK knowledge layer:\n${knowledgeContext}`;
        }

        messages.push({ role: "user", content: userPrompt });

        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages,
                max_tokens: 300,
                temperature: 0.8,
            }),
        });

        if (!resp.ok) {
            const errText = await resp.text();
            return res.status(500).json({
                success: false,
                error: `OpenAI API error: ${errText}`,
            });
        }

        const data = await resp.json();
        const content = (data.choices?.[0]?.message?.content || "").trim();

        return res.status(200).json({
            success: true,
            response: content,
            // Stage is now controlled by the frontend — no LLM parsing needed
            nextStage: currentStage,
            usage: data.usage,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
