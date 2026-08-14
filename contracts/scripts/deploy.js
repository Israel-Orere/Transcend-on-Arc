// Deploys BusinessRegistry + InvestmentPool to Arc Testnet, wired to Arc's
// real USDC ERC-20 interface (0x3600...0000 on Arc Testnet, per
// docs.arc.network). Run with:
//
//   PRIVATE_KEY=0x... npm run deploy:arc-testnet
//
// Fund your deployer address with testnet USDC first: https://faucet.circle.com
const hre = require("hardhat");

// Arc Testnet USDC ERC-20 interface address (6 decimals). See
// docs.arc.io/arc/references/contract-addresses#usdc. Override via env for
// other networks (e.g. a MockUSDC address on a local node).
const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required; refusing to deploy with a fallback account");
  }
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;
  console.log(`Deploying to network: ${network}`);
  console.log(`Deployer: ${deployer.address}`);

  const usdcAddress = process.env.USDC_ADDRESS || ARC_TESTNET_USDC;
  console.log(`USDC token: ${usdcAddress}`);

  const BusinessRegistry = await hre.ethers.getContractFactory("BusinessRegistry");
  const registry = await BusinessRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  console.log(`BusinessRegistry deployed: ${await registry.getAddress()}`);

  const InvestmentPool = await hre.ethers.getContractFactory("InvestmentPool");
  const pool = await InvestmentPool.deploy(usdcAddress, await registry.getAddress(), deployer.address);
  await pool.waitForDeployment();
  console.log(`InvestmentPool deployed: ${await pool.getAddress()}`);

  const tx = await registry.setPoolAuthorized(await pool.getAddress(), true);
  await tx.wait();
  console.log(`Authorized InvestmentPool on BusinessRegistry`);

  console.log("\nDeployment summary:");
  console.log(
    JSON.stringify(
      {
        network,
        usdc: usdcAddress,
        businessRegistry: await registry.getAddress(),
        investmentPool: await pool.getAddress(),
        admin: deployer.address,
      },
      null,
      2
    )
  );
  console.log("\nAdd a verifier before running any deals:");
  console.log(`  registry.addVerifier(<verifierAddress>, "Name")`);
  console.log("\nOptional deal-level controls now available to admin:");
  console.log(`  pool.assignVerifier(dealId, verifierAddress)  -- pin a specific verifier to a deal`);
  console.log(`  pool.setLargeMilestoneThreshold(amount)       -- require 2 verifiers above this USDC amount`);
  console.log(`  pool.pauseDeal(dealId) / pool.unpauseDeal(dealId) -- emergency-freeze fund flow on a deal`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
