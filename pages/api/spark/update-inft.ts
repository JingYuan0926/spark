import type { NextApiRequest, NextApiResponse } from "next";
import { ethers, keccak256, toUtf8Bytes } from "ethers";
import { ZgFile, Indexer } from "@0gfoundation/0g-ts-sdk";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { SPARKINFT_ABI, SPARKINFT_ADDRESS } from "@/lib/sparkinft-abi";

// ── 0G Config ────────────────────────────────────────────────────
const ZG_RPC = "https://evmrpc-testnet.0g.ai";
const ZG_INDEXER = "https://indexer-storage-testnet-turbo.0g.ai";

const VALID_TYPES = ["memory", "skills", "heartbeat", "personality"] as const;
type DataType = (typeof VALID_TYPES)[number];

interface FileEntry {
  content: string;
  label: string;
  type: DataType;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "POST only" });
  }

  const { tokenId, files } = req.body;

  if (!tokenId || !files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: "Required: tokenId (number), files (array of {content, label, type})",
    });
  }

  for (const f of files) {
    if (!f.content || !f.type || !(VALID_TYPES as readonly string[]).includes(f.type)) {
      return res.status(400).json({
        success: false,
        error: `Each file needs content and type (one of: ${VALID_TYPES.join(", ")})`,
      });
    }
  }

  const zgPrivateKey = process.env.ZG_STORAGE_PRIVATE_KEY;
  if (!zgPrivateKey) {
    return res.status(500).json({ success: false, error: "Missing ZG_STORAGE_PRIVATE_KEY" });
  }

  try {
    const provider = new ethers.JsonRpcProvider(ZG_RPC);
    const zgSigner = new ethers.Wallet(zgPrivateKey, provider);
    const indexer = new Indexer(ZG_INDEXER);
    const inftContract = new ethers.Contract(SPARKINFT_ADDRESS, SPARKINFT_ABI, zgSigner);

    // Step 1: Read existing intelligent data
    const existingData = await inftContract.intelligentDatasOf(tokenId);
    const mapped = existingData.map((d: { dataDescription: string; dataHash: string }) => ({
      dataDescription: d.dataDescription,
      dataHash: d.dataHash,
    }));

    // Step 2: Upload each file to 0G Storage
    const newEntries: { dataDescription: string; dataHash: string }[] = [];
    const uploadedDetails: { dataDescription: string; dataHash: string; zgRootHash: string; zgTxHash: string }[] = [];

    for (const file of files as FileEntry[]) {
      const contentJson = JSON.stringify({
        type: file.type,
        label: file.label || file.type,
        content: file.content,
        timestamp: new Date().toISOString(),
      }, null, 2);

      const tmpPath = join(tmpdir(), `spark-inft-${file.type}-${Date.now()}.json`);
      writeFileSync(tmpPath, contentJson);

      const zgFile = await ZgFile.fromFilePath(tmpPath);
      const [tree, treeErr] = await zgFile.merkleTree();
      if (treeErr || !tree) throw new Error(`Merkle tree: ${treeErr}`);
      const rootHash = tree.rootHash();

      const [zgResult, uploadErr] = await indexer.upload(zgFile, ZG_RPC, zgSigner);
      if (uploadErr) throw new Error(`0G upload: ${uploadErr}`);
      const zgTxHash = zgResult
        ? "txHash" in zgResult
          ? zgResult.txHash
          : zgResult.txHashes?.[0] ?? ""
        : "";

      await zgFile.close();
      unlinkSync(tmpPath);

      const dataHash = keccak256(toUtf8Bytes(contentJson));
      const entry = {
        dataDescription: `0g://${file.type}/${rootHash}`,
        dataHash,
      };
      newEntries.push(entry);
      uploadedDetails.push({ ...entry, zgRootHash: rootHash, zgTxHash });
    }

    // Step 3: Append and update on-chain
    const updatedData = [...mapped, ...newEntries];
    const tx = await inftContract.updateData(tokenId, updatedData);
    await tx.wait();

    return res.status(200).json({
      success: true,
      tokenId,
      uploadedEntries: uploadedDetails,
      updateDataTxHash: tx.hash,
      totalEntries: updatedData.length,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
