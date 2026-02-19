import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
import {
  PAYROLL_VAULT_ADDRESS,
  PAYROLL_VAULT_ABI,
  HEDERA_RPC_URL,
} from "@/lib/payroll-vault-abi";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { tokenAddress, vaultAddress } = req.body;
  const vaultAddr = vaultAddress || PAYROLL_VAULT_ADDRESS;

  if (!vaultAddr) {
    return res.status(400).json({ success: false, error: "No vault address" });
  }

  const privateKey = process.env.HEDERA_PRIVATE_KEY;
  if (!privateKey) {
    return res
      .status(500)
      .json({ success: false, error: "Missing HEDERA_PRIVATE_KEY in env" });
  }

  try {
    const provider = new ethers.JsonRpcProvider(HEDERA_RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);
    const vault = new ethers.Contract(vaultAddr, PAYROLL_VAULT_ABI, wallet);

    const results: string[] = [];

    // If tokenAddress provided, associate + set; if empty string, clear back to HBAR
    const token = tokenAddress || ethers.ZeroAddress;

    if (token !== ethers.ZeroAddress) {
      // Associate the vault with the HTS token first
      try {
        const assocTx = await vault.associateToken(token);
        await assocTx.wait();
        results.push(`Vault associated with token ${token}`);
      } catch (e) {
        // Might already be associated
        results.push(`Association skipped (may already be associated)`);
      }
    }

    // Set payment token
    const tx = await vault.setPaymentToken(token);
    await tx.wait();
    results.push(
      token === ethers.ZeroAddress
        ? "Payment mode: HBAR"
        : `Payment token set to ${token}`
    );

    return res.status(200).json({
      success: true,
      message: results.join("; "),
      paymentToken: token,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ success: false, error: msg });
  }
}
