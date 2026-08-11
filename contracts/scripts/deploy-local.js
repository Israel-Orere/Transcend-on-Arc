// Deploys MockUSDC + BusinessRegistry + InvestmentPool to the persistent
// local Hardhat node (localhost:8545) and seeds a small amount of demo data
// so the backend indexer and frontend have something real to show.
//
//   npx hardhat run scripts/deploy-local.js --network localhost --no-compile
//
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer, verifier1, business1, supplier1, investor1, investor2, investor3] =
    await hre.ethers.getSigners();

  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();

  const BusinessRegistry = await hre.ethers.getContractFactory("BusinessRegistry");
  const registry = await BusinessRegistry.deploy(deployer.address);
  await registry.waitForDeployment();

  const InvestmentPool = await hre.ethers.getContractFactory("InvestmentPool");
  const pool = await InvestmentPool.deploy(await usdc.getAddress(), await registry.getAddress(), deployer.address);
  await pool.waitForDeployment();

  await (await registry.setPoolAuthorized(await pool.getAddress(), true)).wait();
  await (await registry.addVerifier(verifier1.address, "Lagos Field Agent")).wait();

  // Seed demo actors with mock USDC
  const USDC = (n) => hre.ethers.parseUnits(n.toString(), 6);
  for (const acct of [business1, supplier1, investor1, investor2, investor3]) {
    await (await usdc.mint(acct.address, USDC(1_000_000))).wait();
    await (await usdc.connect(acct).approve(await pool.getAddress(), hre.ethers.MaxUint256)).wait();
  }

  // Register + verify a demo business and a demo supplier
  await (
    await registry
      .connect(business1)
      .registerBusiness("Amara Provisions", "Retail", "Lagos", "Nigeria", hre.ethers.id("CAC-1234567"))
  ).wait();
  await (await registry.verifyBusiness(business1.address)).wait();

  await (
    await registry
      .connect(supplier1)
      .registerBusiness("Coastal Wholesale Foods", "Distribution", "Lagos", "Nigeria", hre.ethers.id("CAC-7654321"))
  ).wait();
  await (await registry.verifyBusiness(supplier1.address)).wait();

  // Create and partially fund a demo deal
  const DAY = 24 * 60 * 60;
  await (
    await pool
      .connect(business1)
      .createDeal(
        USDC(500),
        1000, // 10% collateral
        2000, // 20% profit share
        30 * DAY,
        3,
        ["Stock rice & oil from Coastal Wholesale", "Shop refurbishment"],
        [USDC(300), USDC(200)],
        [supplier1.address, hre.ethers.ZeroAddress],
        0
      )
  ).wait();

  await (await pool.connect(investor1).invest(1, USDC(200))).wait();
  await (await pool.connect(investor2).invest(1, USDC(150))).wait();
  // Deal left partially funded (350/500) so the frontend has a live "Raising" deal to show

  const summary = {
    network: "localhost",
    chainId: 31337,
    usdc: await usdc.getAddress(),
    businessRegistry: await registry.getAddress(),
    investmentPool: await pool.getAddress(),
    admin: deployer.address,
    demoVerifier: verifier1.address,
    demoBusiness: business1.address,
    demoSupplier: supplier1.address,
    demoInvestors: [investor1.address, investor2.address, investor3.address],
  };

  console.log(JSON.stringify(summary, null, 2));

  const outPath = path.join(__dirname, "..", "..", "backend", "deployment.local.json");
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
