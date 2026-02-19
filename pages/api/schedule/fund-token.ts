import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
import {
  PAYROLL_VAULT_ADDRESS,
  PAYROLL_VAULT_ABI,
  HEDERA_RPC_URL,
} from "@/lib/payroll-vault-abi";

// Minimal ERC-20 ABI for approve
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { amount, vaultAddress } = req.body;
  const vaultAddr = vaultAddress || PAYROLL_VAULT_ADDRESS;

  if (!vaultAddr || !amount) {
    return res
      .status(400)
      .json({ success: false, error: "vaultAddress and amount required" });
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

    // Get the payment token address from the vault
    const tokenAddr = await vault.paymentToken();
    if (tokenAddr === ethers.ZeroAddress) {
      return res.status(400).json({
        success: false,
        error: "No payment token set — use Fund HBAR instead",
      });
    }

    const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);
    const decimals = await token.decimals();
    const rawAmount = ethers.parseUnits(String(amount), decimals);

    // Approve vault to pull tokens
    const approveTx = await token.approve(vaultAddr, rawAmount);
    await approveTx.wait();

    // Fund vault
    const fundTx = await vault.fundVaultToken(rawAmount);
    await fundTx.wait();

    const newBal = await token.balanceOf(vaultAddr);

    return res.status(200).json({
      success: true,
      txHash: fundTx.hash,
      amount: amount,
      token: tokenAddr,
      newBalance: newBal.toString(),
      message: `Funded ${amount} tokens to vault`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ success: false, error: msg });
  }
}
