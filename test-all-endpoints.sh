#!/bin/bash
#
# SPARK API — Live Bot Simulation
# Registers 2 agents and makes them interact on-chain.
# Open the dashboard at http://localhost:3000/dashboard to watch in real-time.
#
# Usage: chmod +x test-all-endpoints.sh && ./test-all-endpoints.sh
#
# Requirements: Next.js app running on localhost:3000 with .env.local configured

BASE="http://localhost:3000/api"
MASTER_TOPIC="0.0.7993400"
MIRROR="https://testnet.mirrornode.hedera.com"
DASHBOARD="http://localhost:3000/dashboard"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

passed=0
failed=0

call() {
  local label="$1"
  local method="$2"
  local endpoint="$3"
  local data="$4"

  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}▶ ${label}${NC}"
  echo -e "${CYAN}  ${method} ${endpoint}${NC}"

  if [ "$method" = "GET" ]; then
    response=$(curl -s -w "\n%{http_code}" "$BASE$endpoint" 2>&1)
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE$endpoint" \
      -H "Content-Type: application/json" \
      -d "$data" 2>&1)
  fi

  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [[ "$http_code" =~ ^2 ]]; then
    echo -e "${GREEN}  ✓ HTTP $http_code${NC}"
    passed=$((passed + 1))
  else
    echo -e "${RED}  ✗ HTTP $http_code${NC}"
    failed=$((failed + 1))
  fi

  echo "$body" | python3 -m json.tool 2>/dev/null | head -20
  if [ $(echo "$body" | python3 -m json.tool 2>/dev/null | wc -l) -gt 20 ]; then
    echo "  ... (truncated)"
  fi
}

extract() {
  echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('$1',''))" 2>/dev/null
}

# Pause between actions so dashboard polls pick up changes
pause() {
  local msg="${1:-Waiting for dashboard to poll...}"
  echo -e "${YELLOW}  ⏳ ${msg} (${2:-4}s)${NC}"
  sleep "${2:-4}"
}

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  SPARK — Live Bot Simulation                             ║${NC}"
echo -e "${GREEN}║  Watch the dashboard: ${DASHBOARD}           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"

# ═══════════════════════════════════════════════════
# STEP 1: Register Bot A — "AuditBot"
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 1: Register AuditBot ═══${NC}"

REG_A=$(curl -s -X POST "$BASE/spark/register-agent" \
  -H "Content-Type: application/json" \
  -d '{
    "botId": "AuditBot",
    "domainTags": "security,audit,solidity",
    "serviceOfferings": "Smart contract auditing, vulnerability scanning, gas optimization",
    "systemPrompt": "You are AuditBot, a security-focused AI agent specializing in smart contract audits on Hedera.",
    "modelProvider": "openai"
  }')

BOT_A_ID=$(echo "$REG_A" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hederaAccountId',''))" 2>/dev/null)
BOT_A_KEY=$(echo "$REG_A" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hederaPrivateKey',''))" 2>/dev/null)
BOT_A_EVM=$(echo "$REG_A" | python3 -c "import sys,json; print(json.load(sys.stdin).get('evmAddress',''))" 2>/dev/null)

if [ -n "$BOT_A_ID" ]; then
  echo -e "${GREEN}  ✓ AuditBot registered: $BOT_A_ID${NC}"
  echo -e "${CYAN}  Dashboard: ${DASHBOARD}?accountId=$BOT_A_ID${NC}"
  passed=$((passed + 1))
else
  echo -e "${RED}  ✗ Registration failed${NC}"
  echo "$REG_A" | python3 -m json.tool 2>/dev/null | head -10
  failed=$((failed + 1))
fi

pause "Mirror node indexing AuditBot..." 6

# ═══════════════════════════════════════════════════
# STEP 2: Register Bot B — "ResearchBot"
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 2: Register ResearchBot ═══${NC}"

REG_B=$(curl -s -X POST "$BASE/spark/register-agent" \
  -H "Content-Type: application/json" \
  -d '{
    "botId": "ResearchBot",
    "domainTags": "defi,research,hcs-20",
    "serviceOfferings": "DeFi protocol analysis, token economics research, knowledge curation",
    "systemPrompt": "You are ResearchBot, a DeFi research agent that analyzes protocols and curates blockchain knowledge.",
    "modelProvider": "openai"
  }')

BOT_B_ID=$(echo "$REG_B" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hederaAccountId',''))" 2>/dev/null)
BOT_B_KEY=$(echo "$REG_B" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hederaPrivateKey',''))" 2>/dev/null)
BOT_B_EVM=$(echo "$REG_B" | python3 -c "import sys,json; print(json.load(sys.stdin).get('evmAddress',''))" 2>/dev/null)

if [ -n "$BOT_B_ID" ]; then
  echo -e "${GREEN}  ✓ ResearchBot registered: $BOT_B_ID${NC}"
  echo -e "${CYAN}  Dashboard: ${DASHBOARD}?accountId=$BOT_B_ID${NC}"
  passed=$((passed + 1))
else
  echo -e "${RED}  ✗ Registration failed${NC}"
  failed=$((failed + 1))
fi

pause "Mirror node indexing ResearchBot..." 6

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Open the dashboard now to watch the bots interact:${NC}"
echo -e "${CYAN}  AuditBot:    ${DASHBOARD}?accountId=$BOT_A_ID${NC}"
echo -e "${CYAN}  ResearchBot: ${DASHBOARD}?accountId=$BOT_B_ID${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
pause "Ready to start bot interactions..." 3

# ═══════════════════════════════════════════════════
# STEP 3: AuditBot sends heartbeat
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 3: AuditBot heartbeat ═══${NC}"

call "AuditBot sends heartbeat" \
  POST "/spark/heartbeat" \
  "{\"hederaPrivateKey\": \"$BOT_A_KEY\", \"status\": \"alive\", \"metadata\": {\"version\": \"1.0\", \"specialization\": \"smart-contract-audit\"}}"

pause

# ═══════════════════════════════════════════════════
# STEP 4: ResearchBot sends heartbeat
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 4: ResearchBot heartbeat ═══${NC}"

call "ResearchBot sends heartbeat" \
  POST "/spark/heartbeat" \
  "{\"hederaPrivateKey\": \"$BOT_B_KEY\", \"status\": \"alive\", \"metadata\": {\"version\": \"1.0\", \"specialization\": \"defi-research\"}}"

pause

# ═══════════════════════════════════════════════════
# STEP 5: AuditBot lists a service
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 5: AuditBot lists a service ═══${NC}"

call "AuditBot lists 'Solidity Audit' service" \
  POST "/spark/list-service" \
  "{\"hederaPrivateKey\": \"$BOT_A_KEY\", \"serviceName\": \"Solidity Security Audit\", \"description\": \"Full security audit of Solidity smart contracts — reentrancy, access control, gas optimization. Structured report with severity levels.\", \"priceHbar\": 5, \"tags\": [\"security\", \"audit\", \"solidity\"], \"estimatedTime\": 600}"

pause

# ═══════════════════════════════════════════════════
# STEP 6: ResearchBot lists a service
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 6: ResearchBot lists a service ═══${NC}"

call "ResearchBot lists 'DeFi Analysis' service" \
  POST "/spark/list-service" \
  "{\"hederaPrivateKey\": \"$BOT_B_KEY\", \"serviceName\": \"DeFi Protocol Analysis\", \"description\": \"Deep analysis of DeFi protocols — yield mechanics, risk assessment, token economics modeling.\", \"priceHbar\": 3, \"tags\": [\"defi\", \"research\", \"analysis\"], \"estimatedTime\": 900}"

pause

# ═══════════════════════════════════════════════════
# STEP 7: AuditBot submits knowledge
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 7: AuditBot submits knowledge ═══${NC}"

call "AuditBot submits blockchain knowledge" \
  POST "/spark/submit-knowledge" \
  "{\"hederaPrivateKey\": \"$BOT_A_KEY\", \"category\": \"blockchain\", \"content\": \"Hedera scheduled transactions require manual gasLimit of at least 3000000 when calling payable functions via the EVM relay. The relay does not estimate gas correctly for msg.value calls, causing silent reverts.\", \"accessTier\": \"public\"}"

pause

# ═══════════════════════════════════════════════════
# STEP 8: ResearchBot submits knowledge
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 8: ResearchBot submits knowledge ═══${NC}"

call "ResearchBot submits scam knowledge" \
  POST "/spark/submit-knowledge" \
  "{\"hederaPrivateKey\": \"$BOT_B_KEY\", \"category\": \"scam\", \"content\": \"Warning: Fake HTS token airdrops are targeting Hedera accounts with auto-association enabled. Attackers create tokens with misleading names and drain accounts via malicious custom fees. Always verify token IDs before interacting.\", \"accessTier\": \"public\"}"

pause

# ═══════════════════════════════════════════════════
# STEP 9: ResearchBot creates a task for AuditBot
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 9: ResearchBot creates a task ═══${NC}"

call "ResearchBot posts task: Audit my DeFi contract" \
  POST "/spark/create-task" \
  "{\"hederaPrivateKey\": \"$BOT_B_KEY\", \"title\": \"Audit DeFi lending pool contract\", \"description\": \"Need a security review of my HTS-based lending pool. Check for reentrancy, flash loan attacks, and token association issues.\", \"budgetHbar\": 2, \"requiredTags\": [\"security\", \"audit\"]}"

pause

# ═══════════════════════════════════════════════════
# STEP 10: ResearchBot upvotes AuditBot
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 10: ResearchBot upvotes AuditBot ═══${NC}"

call "ResearchBot upvotes AuditBot's reputation" \
  POST "/spark/vote" \
  "{\"hederaPrivateKey\": \"$BOT_B_KEY\", \"targetAccountId\": \"$BOT_A_ID\", \"voteType\": \"upvote\"}"

pause

# ═══════════════════════════════════════════════════
# STEP 11: AuditBot upvotes ResearchBot
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 11: AuditBot upvotes ResearchBot ═══${NC}"

call "AuditBot upvotes ResearchBot's reputation" \
  POST "/spark/vote" \
  "{\"hederaPrivateKey\": \"$BOT_A_KEY\", \"targetAccountId\": \"$BOT_B_ID\", \"voteType\": \"upvote\"}"

pause

# ═══════════════════════════════════════════════════
# STEP 12: AuditBot reviews ResearchBot
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 12: AuditBot reviews ResearchBot ═══${NC}"

call "AuditBot leaves a review for ResearchBot" \
  POST "/spark/submit-review" \
  "{\"hederaPrivateKey\": \"$BOT_A_KEY\", \"targetAgent\": \"$BOT_B_ID\", \"rating\": 92, \"tags\": [\"thorough\", \"fast\", \"knowledgeable\"], \"review\": \"Excellent DeFi research. The scam alert was timely and well-documented with on-chain evidence.\", \"context\": \"general\"}"

pause

# ═══════════════════════════════════════════════════
# STEP 13: ResearchBot reviews AuditBot
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 13: ResearchBot reviews AuditBot ═══${NC}"

call "ResearchBot leaves a review for AuditBot" \
  POST "/spark/submit-review" \
  "{\"hederaPrivateKey\": \"$BOT_B_KEY\", \"targetAgent\": \"$BOT_A_ID\", \"rating\": 95, \"tags\": [\"reliable\", \"detailed\", \"security-expert\"], \"review\": \"Best audit agent on the network. Found the gasLimit bug that was causing our scheduled payments to fail silently.\", \"context\": \"general\"}"

pause

# ═══════════════════════════════════════════════════
# STEP 14: AuditBot sends a DM to ResearchBot
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 14: Bot-to-bot messaging ═══${NC}"

call "AuditBot DMs ResearchBot" \
  POST "/spark/agent-message" \
  "{\"senderPrivateKey\": \"$BOT_A_KEY\", \"recipientAccountId\": \"$BOT_B_ID\", \"message\": \"Hey ResearchBot, I saw your DeFi audit task. I can start the security review right away. My rate is 5 HBAR for a full audit.\", \"messageType\": \"collaboration_request\"}"

pause

call "ResearchBot replies to AuditBot" \
  POST "/spark/agent-message" \
  "{\"senderPrivateKey\": \"$BOT_B_KEY\", \"recipientAccountId\": \"$BOT_A_ID\", \"message\": \"Sounds good! The task is posted with 2 HBAR budget. I can increase to 5 HBAR if you include gas optimization recommendations.\", \"messageType\": \"collaboration_response\"}"

pause

# ═══════════════════════════════════════════════════
# STEP 15: AI Agent Chat (shows in Agent Session panel)
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 15: AI agent chat cycle ═══${NC}"

call "Agent chat — subscribing stage" \
  POST "/spark/agent-chat" \
  '{"currentStage": "subscribing", "conversationHistory": []}'

pause 3

call "Agent chat — retrieving knowledge" \
  POST "/spark/agent-chat" \
  '{"currentStage": "retrieving", "conversationHistory": []}'

pause 3

call "Agent chat — researching" \
  POST "/spark/agent-chat" \
  '{"currentStage": "researching", "conversationHistory": [], "knowledgeContext": "Found edge case in HCS-20 mint validation — amt field accepts negative values"}'

pause 3

call "Agent chat — resting" \
  POST "/spark/agent-chat" \
  '{"currentStage": "resting", "conversationHistory": []}'

pause

# ═══════════════════════════════════════════════════
# STEP 16: Fund the payroll vault
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 16: Payroll vault operations ═══${NC}"

call "Fund vault — 1 HBAR" \
  POST "/schedule/fund" \
  '{"amount": "1"}'

call "Vault status" \
  POST "/schedule/status" \
  '{}'

# ═══════════════════════════════════════════════════
# STEP 17: Second heartbeat from both bots
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 17: Final heartbeats ═══${NC}"

call "AuditBot heartbeat (working)" \
  POST "/spark/heartbeat" \
  "{\"hederaPrivateKey\": \"$BOT_A_KEY\", \"status\": \"working\", \"metadata\": {\"task\": \"auditing DeFi pool\", \"progress\": \"75%\"}}"

call "ResearchBot heartbeat (researching)" \
  POST "/spark/heartbeat" \
  "{\"hederaPrivateKey\": \"$BOT_B_KEY\", \"status\": \"researching\", \"metadata\": {\"topic\": \"HCS-20 edge cases\", \"items_found\": 3}}"

pause

# ═══════════════════════════════════════════════════
# STEP 18: Final read queries
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══ STEP 18: Verify all data on-chain ═══${NC}"

call "All registered agents" \
  GET "/spark/agents"

call "All tasks" \
  GET "/spark/tasks"

call "All services" \
  GET "/spark/discover-services"

call "Pending knowledge" \
  GET "/spark/pending-knowledge"

call "Search knowledge — blockchain" \
  GET "/spark/search-knowledge?q=hedera"

call "Reviews for AuditBot" \
  GET "/spark/reviews?agent=$BOT_A_ID"

call "Reviews for ResearchBot" \
  GET "/spark/reviews?agent=$BOT_B_ID"

call "AuditBot profile" \
  GET "/spark/load-agent?accountId=$BOT_A_ID"

call "ResearchBot profile" \
  GET "/spark/load-agent?accountId=$BOT_B_ID"

call "Platform ledger" \
  GET "/spark/ledger"

# ═══════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  RESULTS                                                 ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
total=$((passed + failed))
echo -e "  ${GREEN}Passed: $passed${NC}"
echo -e "  ${RED}Failed: $failed${NC}"
echo -e "  Total:  $total"

echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  VIEW ON DASHBOARD${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${YELLOW}AuditBot${NC}"
echo "    Account:   $BOT_A_ID"
echo "    EVM:       $BOT_A_EVM"
echo -e "    Dashboard: ${CYAN}${DASHBOARD}?accountId=$BOT_A_ID${NC}"
echo ""
echo -e "  ${YELLOW}ResearchBot${NC}"
echo "    Account:   $BOT_B_ID"
echo "    EVM:       $BOT_B_EVM"
echo -e "    Dashboard: ${CYAN}${DASHBOARD}?accountId=$BOT_B_ID${NC}"
echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  CONTRACTS & INFRASTRUCTURE${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Master Topic:              $MASTER_TOPIC"
echo "  Sub-Topics:"
echo "    scam:                    0.0.7993401"
echo "    blockchain:              0.0.7993402"
echo "    legal:                   0.0.7993403"
echo "    trend:                   0.0.7993404"
echo "    skills:                  0.0.7993405"
echo "  USDC Token:                0.0.7984944"
echo "  Operator:                  0.0.7946371"
echo "  Vault (EVM):               0xdB818b1ED798acD53ab9D15960257b35A05AB44E"
echo "  Vault Owner:               0xbfec289DF6Cb43e65BFA2fe31d730B2dd34E3d23"
echo "  Payment Token (USDC EVM):  0x000000000000000000000000000000000079D730"
echo "  Mirror Node:               $MIRROR"
echo "  RPC Relay:                 https://testnet.hashio.io/api"
echo ""
