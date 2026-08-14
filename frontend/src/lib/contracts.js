import { BusinessRegistryABI, InvestmentPoolABI } from "./chain";

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
];

// Every write action funnels through here, and every write action re-checks
// the wallet's active chain first. Checking only once at "Connect wallet"
// time isn't enough -- MetaMask can lose track of an unrecognized local
// chain between actions, and the failure then surfaces deep inside
// writeContract as an opaque "Unrecognized chain ID" error instead of a
// clear add-network prompt.
async function ensureWalletOnChain(walletClient) {
  const targetChain = walletClient.chain;
  const hexChainId = "0x" + targetChain.id.toString(16);
  const currentHex = await walletClient.request({ method: "eth_chainId" });
  if (currentHex.toLowerCase() === hexChainId.toLowerCase()) return;

  try {
    await walletClient.switchChain({ id: targetChain.id });
  } catch (err) {
    if (err.code === 4902 || /Unrecognized chain/i.test(err.message || "")) {
      await walletClient.addChain({ chain: targetChain });
      await walletClient.switchChain({ id: targetChain.id });
    } else {
      throw err;
    }
  }
}

async function send(walletClient, publicClient, params) {
  await ensureWalletOnChain(walletClient);
  const account = walletClient.account?.address || (await walletClient.getAddresses())[0];
  const hash = await walletClient.writeContract({ ...params, account });
  return publicClient.waitForTransactionReceipt({ hash });
}

export async function ensureUsdcApproval(walletClient, publicClient, { usdc, spender, owner, amount }) {
  const allowance = await publicClient.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (allowance >= amount) return;
  await send(walletClient, publicClient, {
    address: usdc,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
  });
}

export const registryActions = {
  registerBusiness: (walletClient, publicClient, registryAddr, { name, category, city, country, regNumberHash }) =>
    send(walletClient, publicClient, {
      address: registryAddr,
      abi: BusinessRegistryABI,
      functionName: "registerBusiness",
      args: [name, category, city, country, regNumberHash],
    }),
  verifyBusiness: (walletClient, publicClient, registryAddr, business) =>
    send(walletClient, publicClient, {
      address: registryAddr,
      abi: BusinessRegistryABI,
      functionName: "verifyBusiness",
      args: [business],
    }),
  endorseMerchant: (
    walletClient,
    publicClient,
    registryAddr,
    { merchant, relationshipHash, evidenceHash, relationshipMonths, rating, expiresAt, relatedParty }
  ) =>
    send(walletClient, publicClient, {
      address: registryAddr,
      abi: BusinessRegistryABI,
      functionName: "endorseMerchant",
      args: [merchant, relationshipHash, evidenceHash, relationshipMonths, rating, expiresAt, relatedParty],
    }),
  revokeSupplierEndorsement: (walletClient, publicClient, registryAddr, merchant) =>
    send(walletClient, publicClient, {
      address: registryAddr,
      abi: BusinessRegistryABI,
      functionName: "revokeSupplierEndorsement",
      args: [merchant],
    }),
  publishUnderwritingReport: (
    walletClient,
    publicClient,
    registryAddr,
    { business, dataRoomHash, reportHash, verifiedRevenueUSDC, grossProfitUSDC, ebitdaUSDC,
      averageMonthlyBankInflowsUSDC, existingDebtUSDC, bankCoverageBps, cashFlowStabilityBps,
      statementMonths, riskGrade, validUntil, decision }
  ) => send(walletClient, publicClient, {
    address: registryAddr,
    abi: BusinessRegistryABI,
    functionName: "publishUnderwritingReport",
    args: [business, dataRoomHash, reportHash, verifiedRevenueUSDC, grossProfitUSDC, ebitdaUSDC,
      averageMonthlyBankInflowsUSDC, existingDebtUSDC, bankCoverageBps, cashFlowStabilityBps,
      statementMonths, riskGrade, validUntil, decision],
  }),
};

export const poolActions = {
  invest: async (walletClient, publicClient, poolAddr, usdcAddr, dealId, amount) => {
    const account = walletClient.account?.address || (await walletClient.getAddresses())[0];
    await ensureUsdcApproval(walletClient, publicClient, {
      usdc: usdcAddr,
      spender: poolAddr,
      owner: account,
      amount,
    });
    return send(walletClient, publicClient, {
      address: poolAddr,
      abi: InvestmentPoolABI,
      functionName: "invest",
      args: [dealId, amount],
    });
  },

  createDeal: (
    walletClient,
    publicClient,
    poolAddr,
    usdcAddr,
    {
      targetAmount,
      collateralBps,
      profitShareBps,
      repaymentIntervalSeconds,
      numRepayments,
      milestoneDescriptions,
      milestoneAmounts,
      milestonePayees,
      repaymentCapUSDC,
    }
  ) =>
    (async () => {
      const account = walletClient.account?.address || (await walletClient.getAddresses())[0];
      const collateralAmount = (targetAmount * BigInt(collateralBps)) / 10000n;
      if (collateralAmount > 0n) {
        await ensureUsdcApproval(walletClient, publicClient, {
          usdc: usdcAddr,
          spender: poolAddr,
          owner: account,
          amount: collateralAmount,
        });
      }
      return send(walletClient, publicClient, {
        address: poolAddr,
        abi: InvestmentPoolABI,
        functionName: "createDeal",
        args: [
          targetAmount,
          collateralBps,
          profitShareBps,
          repaymentIntervalSeconds,
          numRepayments,
          milestoneDescriptions,
          milestoneAmounts,
          milestonePayees,
          repaymentCapUSDC,
        ],
      });
    })(),

  requestMilestoneRelease: (walletClient, publicClient, poolAddr, dealId, evidenceHash) =>
    send(walletClient, publicClient, {
      address: poolAddr,
      abi: InvestmentPoolABI,
      functionName: "requestMilestoneRelease",
      args: [dealId, evidenceHash],
    }),

  attestMilestone: (walletClient, publicClient, poolAddr, dealId) =>
    send(walletClient, publicClient, {
      address: poolAddr,
      abi: InvestmentPoolABI,
      functionName: "attestMilestone",
      args: [dealId],
    }),

  confirmReceipt: (walletClient, publicClient, poolAddr, dealId) =>
    send(walletClient, publicClient, {
      address: poolAddr,
      abi: InvestmentPoolABI,
      functionName: "confirmReceipt",
      args: [dealId],
    }),

  approveMilestoneRelease: (walletClient, publicClient, poolAddr, dealId) =>
    send(walletClient, publicClient, {
      address: poolAddr,
      abi: InvestmentPoolABI,
      functionName: "approveMilestoneRelease",
      args: [dealId],
    }),

  submitRevenueReport: (walletClient, publicClient, poolAddr, dealId, grossRevenue, evidenceHash) =>
    send(walletClient, publicClient, {
      address: poolAddr,
      abi: InvestmentPoolABI,
      functionName: "submitRevenueReport",
      args: [dealId, grossRevenue, evidenceHash],
    }),

  attestRevenueReport: (walletClient, publicClient, poolAddr, dealId) =>
    send(walletClient, publicClient, {
      address: poolAddr,
      abi: InvestmentPoolABI,
      functionName: "attestRevenueReport",
      args: [dealId],
    }),

  settleRevenueShare: async (walletClient, publicClient, poolAddr, usdcAddr, dealId, amountDue) => {
    const account = walletClient.account?.address || (await walletClient.getAddresses())[0];
    await ensureUsdcApproval(walletClient, publicClient, {
      usdc: usdcAddr,
      spender: poolAddr,
      owner: account,
      amount: amountDue,
    });
    return send(walletClient, publicClient, {
      address: poolAddr,
      abi: InvestmentPoolABI,
      functionName: "settleRevenueShare",
      args: [dealId],
    });
  },

  withdraw: (walletClient, publicClient, poolAddr, dealId) =>
    send(walletClient, publicClient, {
      address: poolAddr,
      abi: InvestmentPoolABI,
      functionName: "withdraw",
      args: [dealId],
    }),
};
