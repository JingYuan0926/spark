import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
import { Indexer } from "@0gfoundation/0g-ts-sdk";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { SPARKINFT_ABI, SPARKINFT_ADDRESS } from "@/lib/sparkinft-abi";

// ── 0G Config ────────────────────────────────────────────────────
const ZG_RPC = "https://evmrpc-testnet.0g.ai";
const ZG_INDEXER = "https://indexer-storage-testnet-turbo.0g.ai";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST only" });
  }

  const { rootHash, tokenId } = req.body;

  // Mode 1: Download a specific file by rootHash
  if (rootHash) {
    try {
      const indexer = new Indexer(ZG_INDEXER);
      const tmpPath = join(tmpdir(), `spark-view-${Date.now()}.json`);

      const err = await indexer.download(rootHash, tmpPath, true);
      if (err) throw new Error(`0G download: ${err}`);

      const content = readFileSync(tmpPath, "utf-8");
      unlinkSync(tmpPath);

      // Try to parse as JSON
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = content;
      }

      return res.status(200).json({
        success: true,
        rootHash,
        content: parsed,
      });
    } catch (err: unknown) {
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Mode 2: List all intelligent data for a tokenId
  if (tokenId !== undefined && tokenId !== null) {
    const zgPrivateKey = process.env.ZG_STORAGE_PRIVATE_KEY;
    if (!zgPrivateKey) {
      return res.status(500).json({ success: false, error: "Missing ZG_STORAGE_PRIVATE_KEY" });
    }

    try {
      const provider = new ethers.JsonRpcProvider(ZG_RPC);
      const zgSigner = new ethers.Wallet(zgPrivateKey, provider);
      const inftContract = new ethers.Contract(SPARKINFT_ADDRESS, SPARKINFT_ABI, zgSigner);

      const data = await inftContract.intelligentDatasOf(tokenId);
      const entries = data.map((d: { dataDescription: string; dataHash: string }) => ({
        dataDescription: d.dataDescription,
        dataHash: d.dataHash,
      }));

      return res.status(200).json({
        success: true,
        tokenId: Number(tokenId),
        entries,
      });
    } catch (err: unknown) {
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return res.status(400).json({
    success: false,
    error: "Required: rootHash (string) or tokenId (number)",
  });
}
