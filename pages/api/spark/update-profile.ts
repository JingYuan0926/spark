import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";

import { SPARKINFT_ABI, SPARKINFT_ADDRESS } from "@/lib/sparkinft-abi";

// ── 0G Chain Config ──────────────────────────────────────────────
const ZG_RPC = "https://evmrpc-testnet.0g.ai";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST only" });
  }

  const { tokenId, domainTags, serviceOfferings } = req.body;

  if (tokenId === undefined || tokenId === null) {
    return res.status(400).json({
      success: false,
      error: "Required: tokenId (number)",
    });
  }

  if (!domainTags && !serviceOfferings) {
    return res.status(400).json({
      success: false,
      error: "Provide at least one of: domainTags, serviceOfferings",
    });
  }

  const zgPrivateKey = process.env.ZG_STORAGE_PRIVATE_KEY;
  if (!zgPrivateKey) {
    return res.status(500).json({ success: false, error: "Missing ZG_STORAGE_PRIVATE_KEY" });
  }

  try {
    const provider = new ethers.JsonRpcProvider(ZG_RPC);
    const zgSigner = new ethers.Wallet(zgPrivateKey, provider);
    const inftContract = new ethers.Contract(SPARKINFT_ADDRESS, SPARKINFT_ABI, zgSigner);

    // Read current profile to fill in missing fields
    const currentProfile = await inftContract.getAgentProfile(tokenId);
    const newDomainTags = domainTags || currentProfile.domainTags;
    const newServiceOfferings = serviceOfferings || currentProfile.serviceOfferings;

    const tx = await inftContract.updateProfile(tokenId, newDomainTags, newServiceOfferings);
    await tx.wait();

    return res.status(200).json({
      success: true,
      tokenId: Number(tokenId),
      domainTags: newDomainTags,
      serviceOfferings: newServiceOfferings,
      txHash: tx.hash,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
