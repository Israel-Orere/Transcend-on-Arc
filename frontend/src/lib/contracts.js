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

async function send(walletClient, publicClient, params) {
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

  remitProfit: async (walletClient, publicClient, poolAddr, usdcAddr, dealId, amount) => {
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
      functionName: "remitProfit",
      args: [dealId, amount],
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
