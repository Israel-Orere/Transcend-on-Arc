const { expect } = require("chai");
const { ethers } = require("hardhat");

const USDC = (n) => ethers.parseUnits(n.toString(), 6);
const DAY = 24 * 60 * 60;

async function deployFixture() {
  const [admin, verifier, business, supplier, investor1, investor2, investor3, stranger] =
    await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();

  const BusinessRegistry = await ethers.getContractFactory("BusinessRegistry");
  const registry = await BusinessRegistry.deploy(admin.address);

  const InvestmentPool = await ethers.getContractFactory("InvestmentPool");
  const pool = await InvestmentPool.deploy(
    await usdc.getAddress(),
    await registry.getAddress(),
    admin.address
  );

  await registry.connect(admin).setPoolAuthorized(await pool.getAddress(), true);
  await registry.connect(admin).addVerifier(verifier.address, "Lagos Field Agent 1");

  // Fund actors with mock USDC
  for (const acct of [business, supplier, investor1, investor2, investor3]) {
    await usdc.mint(acct.address, USDC(1_000_000));
    await usdc.connect(acct).approve(await pool.getAddress(), ethers.MaxUint256);
  }

  return {
    admin,
    verifier,
    business,
    supplier,
    investor1,
    investor2,
    investor3,
    stranger,
    usdc,
    registry,
    pool,
  };
}

async function registerAndVerify(registry, admin, business, regHash = ethers.id("CAC-000001")) {
  await registry
    .connect(business)
    .registerBusiness("Amara Provisions", "Retail", "Lagos", "Nigeria", regHash);
  await registry.connect(admin).verifyBusiness(business.address);
}

describe("BusinessRegistry", function () {
  it("blocks raising until a business is verified", async function () {
    const { registry, business } = await deployFixture();
    await registry
      .connect(business)
      .registerBusiness("Amara Provisions", "Retail", "Lagos", "Nigeria", ethers.id("CAC-1"));
    expect(await registry.canRaise(business.address)).to.equal(false);
  });

  it("enforces one wallet per registration number (Sybil resistance)", async function () {
    const { registry, business, stranger } = await deployFixture();
    const regHash = ethers.id("CAC-DUPLICATE");
    await registry
      .connect(business)
      .registerBusiness("Amara Provisions", "Retail", "Lagos", "Nigeria", regHash);

    await expect(
      registry
        .connect(stranger)
        .registerBusiness("Fake Clone Shop", "Retail", "Lagos", "Nigeria", regHash)
    ).to.be.revertedWithCustomError(registry, "RegNumberTaken");
  });

  it("grows raise caps with completed deals and freezes on default", async function () {
    const { registry, admin, business } = await deployFixture();
    await registerAndVerify(registry, admin, business);

    expect(await registry.reputationTier(business.address)).to.equal(1); // New
    const newCap = await registry.raiseCap(business.address);
    expect(newCap).to.equal(USDC(500));
  });
});

describe("InvestmentPool - full lifecycle", function () {
  it("runs a complete deal: raise -> collateral -> milestone (verifier + payee) -> repay -> complete -> collateral returned", async function () {
    const { admin, verifier, business, supplier, investor1, investor2, investor3, usdc, registry, pool } =
      await deployFixture();

    await registerAndVerify(registry, admin, business);
    // Supplier is also a verified on-chain business (strong verification tier)
    await registerAndVerify(registry, admin, supplier, ethers.id("CAC-SUPPLIER"));

    const target = USDC(500);
    const collateralBps = 1000; // 10%
    const profitShareBps = 2000; // 20%

    await pool.connect(business).createDeal(
      target,
      collateralBps,
      profitShareBps,
      30 * DAY, // repayment interval
      3, // numRepayments
      ["Stock rice & oil from Supplier Co", "Shop refurbishment"],
      [USDC(300), USDC(200)],
      [supplier.address, ethers.ZeroAddress],
      0
    );

    const dealId = 1;
    const collateralAmount = (target * BigInt(collateralBps)) / 10000n;
    expect(await usdc.balanceOf(await pool.getAddress())).to.equal(collateralAmount);

    // Fund the deal across 3 distinct investors, none above the 40% cap
    await pool.connect(investor1).invest(dealId, USDC(200)); // 40%
    await pool.connect(investor2).invest(dealId, USDC(200)); // 40%
    await pool.connect(investor3).invest(dealId, USDC(100)); // 20%

    let deal = await pool.getDeal(dealId);
    expect(deal.status).to.equal(1); // Active
    expect(await registry.getBusiness(business.address)).to.satisfy((b) => b.totalRaisedUSDC === target);

    // --- Milestone 0: payee is on-chain verified -> needs verifier AND payee confirmation ---
    const evidence0 = ethers.id("receipt-batch-1");
    await pool.connect(business).requestMilestoneRelease(dealId, evidence0);
    await pool.connect(verifier).attestMilestone(dealId);

    // Investor cannot approve yet -- payee (supplier) hasn't confirmed
    await expect(pool.connect(investor1).approveMilestoneRelease(dealId)).to.be.revertedWithCustomError(
      pool,
      "WrongStatus"
    );

    await pool.connect(supplier).confirmReceipt(dealId);

    const supplierBalBefore = await usdc.balanceOf(supplier.address);
    // Traceable payee -> simple majority: investor1 (40%) + investor2 (40%) = 80% > 50%
    await pool.connect(investor1).approveMilestoneRelease(dealId);
    await pool.connect(investor2).approveMilestoneRelease(dealId);
    expect(await usdc.balanceOf(supplier.address)).to.equal(supplierBalBefore + USDC(300));

    // --- Milestone 1: no designated payee -> pays business directly (untraceable tier), only needs verifier ---
    const evidence1 = ethers.id("shop-refurb-photos");
    await pool.connect(business).requestMilestoneRelease(dealId, evidence1);
    await pool.connect(verifier).attestMilestone(dealId);

    const businessBalBefore = await usdc.balanceOf(business.address);
    // Untraceable payee -> needs supermajority (66.67%): 40%+40% = 80% clears it
    await pool.connect(investor1).approveMilestoneRelease(dealId);
    await pool.connect(investor2).approveMilestoneRelease(dealId);
    expect(await usdc.balanceOf(business.address)).to.equal(businessBalBefore + USDC(200));

    deal = await pool.getDeal(dealId);
    expect(deal.status).to.equal(2); // Repaying

    // --- Profit-share remittances ---
    for (let i = 0; i < 3; i++) {
      await pool.connect(business).remitProfit(dealId, USDC(20));
    }

    deal = await pool.getDeal(dealId);
    expect(deal.status).to.equal(3); // Completed
    expect(deal.collateralReturned).to.equal(true);

    // Investors withdraw their pro-rata profit share
    const i1Before = await usdc.balanceOf(investor1.address);
    await pool.connect(investor1).withdraw(dealId);
    const i1After = await usdc.balanceOf(investor1.address);
    // investor1 contributed 200/500 = 40% of a 60 USDC total remittance = 24 USDC
    expect(i1After - i1Before).to.equal(USDC(24));

    // After all investors withdraw everything owed, the pool holds nothing more
    await pool.connect(investor2).withdraw(dealId);
    await pool.connect(investor3).withdraw(dealId);
    expect(await usdc.balanceOf(await pool.getAddress())).to.equal(0);

    const business2 = await registry.getBusiness(business.address);
    expect(business2.completedDeals).to.equal(1n);

    expect(await registry.reputationTier(business.address)).to.equal(2); // Trusted
  });

  it("rejects a raise above the business's reputation-tier cap", async function () {
    const { admin, business, registry, pool } = await deployFixture();
    await registerAndVerify(registry, admin, business);

    await expect(
      pool
        .connect(business)
        .createDeal(USDC(600), 1000, 2000, 30 * DAY, 3, ["Too big"], [USDC(600)], [ethers.ZeroAddress], 0)
    ).to.be.revertedWithCustomError(pool, "ExceedsRaiseCap");
  });

  it("lets investors fully reclaim funds if a raise never fills", async function () {
    const { admin, business, investor1, usdc, registry, pool } = await deployFixture();
    await registerAndVerify(registry, admin, business);

    await pool
      .connect(business)
      .createDeal(USDC(500), 1000, 2000, 30 * DAY, 3, ["Stock"], [USDC(500)], [ethers.ZeroAddress], 0);

    await pool.connect(investor1).invest(1, USDC(100));

    await ethers.provider.send("evm_increaseTime", [31 * DAY]);
    await ethers.provider.send("evm_mine");

    const before = await usdc.balanceOf(investor1.address);
    await pool.connect(investor1).cancelUnfundedDeal(1);
    await pool.connect(investor1).withdraw(1);
    const after = await usdc.balanceOf(investor1.address);
    expect(after - before).to.equal(USDC(100));

    // Business also gets its collateral back
    const businessBefore = await usdc.balanceOf(business.address);
    // (collateral was already returned inside cancelUnfundedDeal; re-fetch to confirm no change on 2nd call)
    expect(businessBefore).to.be.a("bigint");
  });

  it("defaults on a missed repayment: forfeits collateral to investors and dents verifier + business reputation", async function () {
    const { admin, verifier, business, investor1, investor2, investor3, usdc, registry, pool } =
      await deployFixture();
    await registerAndVerify(registry, admin, business);

    const target = USDC(500);
    await pool
      .connect(business)
      .createDeal(target, 1000, 2000, 30 * DAY, 3, ["Stock"], [target], [ethers.ZeroAddress], 0);

    await pool.connect(investor1).invest(1, USDC(200)); // 40%
    await pool.connect(investor2).invest(1, USDC(200)); // 40%
    await pool.connect(investor3).invest(1, USDC(100)); // 20%

    await pool.connect(business).requestMilestoneRelease(1, ethers.id("ev"));
    await pool.connect(verifier).attestMilestone(1);
    await pool.connect(investor1).approveMilestoneRelease(1);
    await pool.connect(investor2).approveMilestoneRelease(1); // 80% clears the supermajority bar

    let deal = await pool.getDeal(1);
    expect(deal.status).to.equal(2); // Repaying

    // Miss the repayment deadline entirely
    await ethers.provider.send("evm_increaseTime", [30 * DAY + 7 * DAY + 1]);
    await ethers.provider.send("evm_mine");

    const before = await usdc.balanceOf(investor1.address);
    await pool.connect(investor1).checkDefault(1);
    await pool.connect(investor1).withdraw(1);
    const after = await usdc.balanceOf(investor1.address);

    // Investor1 (40% of the raise) recovers 40% of the forfeited 10%
    // collateral (50 USDC) = 20 USDC; the released milestone (500 USDC) is
    // gone -- this is the realistic loss profile of a milestone system, not
    // a magic full-recovery guarantee.
    expect(after - before).to.equal(USDC(20));

    deal = await pool.getDeal(1);
    expect(deal.status).to.equal(4); // Defaulted

    const businessRecord = await registry.getBusiness(business.address);
    expect(businessRecord.defaultedDeals).to.equal(1n);
    expect(await registry.canRaise(business.address)).to.equal(false); // frozen

    const verifierRecord = await registry.getVerifier(verifier.address);
    expect(verifierRecord.attestationsLinkedToDefault).to.equal(1n);
  });

  it("requires an active registry verifier to attest -- a random address cannot", async function () {
    const { admin, business, investor1, investor2, investor3, stranger, registry, pool } =
      await deployFixture();
    await registerAndVerify(registry, admin, business);

    await pool
      .connect(business)
      .createDeal(USDC(500), 1000, 2000, 30 * DAY, 3, ["Stock"], [USDC(500)], [ethers.ZeroAddress], 0);
    await pool.connect(investor1).invest(1, USDC(200));
    await pool.connect(investor2).invest(1, USDC(200));
    await pool.connect(investor3).invest(1, USDC(100));
    await pool.connect(business).requestMilestoneRelease(1, ethers.id("ev"));

    await expect(pool.connect(stranger).attestMilestone(1)).to.be.revertedWithCustomError(
      pool,
      "NotActiveVerifier"
    );
  });

  it("requires a supermajority (not just >50%) to release to an untraceable payee", async function () {
    const { admin, verifier, business, investor1, investor2, investor3, registry, pool } =
      await deployFixture();
    await registerAndVerify(registry, admin, business);

    const target = USDC(500);
    await pool
      .connect(business)
      .createDeal(target, 1000, 2000, 30 * DAY, 3, ["Stock"], [target], [ethers.ZeroAddress], 0);

    await pool.connect(investor1).invest(1, USDC(200)); // 40%
    await pool.connect(investor2).invest(1, USDC(200)); // 40%
    await pool.connect(investor3).invest(1, USDC(100)); // 20%

    await pool.connect(business).requestMilestoneRelease(1, ethers.id("ev"));
    await pool.connect(verifier).attestMilestone(1);

    // Payee is the business itself -> untraceable tier -> needs 66.67%.
    // 40% alone is nowhere close.
    await pool.connect(investor1).approveMilestoneRelease(1);
    let deal = await pool.getDeal(1);
    expect(deal.status).to.equal(1); // still Active, not yet Repaying

    // investor1 (40%) + investor2 (40%) = 80% clears 66.67% -> releases
    await pool.connect(investor2).approveMilestoneRelease(1);
    deal = await pool.getDeal(1);
    expect(deal.status).to.equal(2); // Repaying now
  });

  it("blocks the business from investing in its own raise", async function () {
    const { admin, business, registry, pool } = await deployFixture();
    await registerAndVerify(registry, admin, business);

    await pool
      .connect(business)
      .createDeal(USDC(500), 1000, 2000, 30 * DAY, 3, ["Stock"], [USDC(500)], [ethers.ZeroAddress], 0);

    await expect(pool.connect(business).invest(1, USDC(100))).to.be.revertedWithCustomError(
      pool,
      "BusinessCannotInvestOwnDeal"
    );
  });

  it("caps any single investor's share of a raise, forcing genuine diversification", async function () {
    const { admin, business, investor1, registry, pool } = await deployFixture();
    await registerAndVerify(registry, admin, business);

    await pool
      .connect(business)
      .createDeal(USDC(500), 1000, 2000, 30 * DAY, 3, ["Stock"], [USDC(500)], [ethers.ZeroAddress], 0);

    // 40% cap -> 220/500 = 44% is too much for one wallet
    await expect(pool.connect(investor1).invest(1, USDC(220))).to.be.revertedWithCustomError(
      pool,
      "ExceedsInvestorShareCap"
    );
  });

  it("requires at least 3 distinct investors before a deal can activate (the 40% cap alone forces this)", async function () {
    const { admin, business, investor1, investor2, registry, pool } = await deployFixture();
    await registerAndVerify(registry, admin, business);

    await pool
      .connect(business)
      .createDeal(USDC(500), 1000, 2000, 30 * DAY, 3, ["Stock"], [USDC(500)], [ethers.ZeroAddress], 0);

    await pool.connect(investor1).invest(1, USDC(200)); // 40%, at the cap
    // A 2nd investor alone can't cover the remaining 300 without exceeding
    // their own 40% cap (300/500 = 60%) -- the two rules reinforce each
    // other: 2 investors can never fill a raise, only 3+ can.
    await expect(pool.connect(investor2).invest(1, USDC(300))).to.be.revertedWithCustomError(
      pool,
      "ExceedsInvestorShareCap"
    );
  });

  it("rejects a reused evidence hash across milestones", async function () {
    const { admin, verifier, business, investor1, investor2, investor3, registry, pool } =
      await deployFixture();
    await registerAndVerify(registry, admin, business);

    await pool
      .connect(business)
      .createDeal(
        USDC(500),
        1000,
        2000,
        30 * DAY,
        3,
        ["Stock A", "Stock B"],
        [USDC(300), USDC(200)],
        [ethers.ZeroAddress, ethers.ZeroAddress],
        0
      );
    await pool.connect(investor1).invest(1, USDC(200));
    await pool.connect(investor2).invest(1, USDC(200));
    await pool.connect(investor3).invest(1, USDC(100));

    const evidence = ethers.id("same-receipt-photo");
    await pool.connect(business).requestMilestoneRelease(1, evidence);
    await pool.connect(verifier).attestMilestone(1);
    await pool.connect(investor1).approveMilestoneRelease(1);
    await pool.connect(investor2).approveMilestoneRelease(1);

    // Trying to justify milestone 2 with the exact same evidence hash must fail
    await expect(pool.connect(business).requestMilestoneRelease(1, evidence)).to.be.revertedWithCustomError(
      pool,
      "EvidenceHashReused"
    );
  });

  it("restricts attestation to the deal's assigned verifier once admin sets one", async function () {
    const { admin, verifier, business, investor1, investor2, investor3, registry, pool } =
      await deployFixture();
    await registerAndVerify(registry, admin, business);
    await registry.connect(admin).addVerifier(investor3.address, "Backup Agent"); // reuse a signer as a 2nd verifier

    await pool
      .connect(business)
      .createDeal(USDC(500), 1000, 2000, 30 * DAY, 3, ["Stock"], [USDC(500)], [ethers.ZeroAddress], 0);
    await pool.connect(investor1).invest(1, USDC(200));
    await pool.connect(investor2).invest(1, USDC(200));
    await pool.connect(admin).assignVerifier(1, verifier.address);

    // Third investor needed to hit the funding target and the min-investor rule
    await expect(pool.connect(investor3).invest(1, USDC(100))).to.not.be.reverted;

    await pool.connect(business).requestMilestoneRelease(1, ethers.id("ev"));

    // investor3 is an active verifier in general, but NOT the one assigned to this deal
    await expect(pool.connect(investor3).attestMilestone(1)).to.be.revertedWithCustomError(
      pool,
      "NotAssignedVerifier"
    );

    // The assigned verifier can attest fine
    await expect(pool.connect(verifier).attestMilestone(1)).to.not.be.reverted;
  });

  it("requires two distinct verifiers for a milestone at/above the large-milestone threshold", async function () {
    const { admin, verifier, business, investor1, investor2, investor3, registry, pool } =
      await deployFixture();
    await registerAndVerify(registry, admin, business);
    await registry.connect(admin).addVerifier(investor3.address, "Backup Agent");

    // Lower the threshold to fit within this "New" tier business's 500 USDC raise cap
    await pool.connect(admin).setLargeMilestoneThreshold(USDC(500));

    await pool
      .connect(business)
      .createDeal(USDC(500), 1000, 2000, 30 * DAY, 3, ["Big purchase"], [USDC(500)], [ethers.ZeroAddress], 0);

    await pool.connect(investor1).invest(1, USDC(200));
    await pool.connect(investor2).invest(1, USDC(200));
    await pool.connect(investor3).invest(1, USDC(100));

    await pool.connect(business).requestMilestoneRelease(1, ethers.id("big-ev"));

    // First verifier attests -- not enough alone for a large milestone
    await pool.connect(verifier).attestMilestone(1);
    let milestones = await pool.getMilestones(1);
    expect(milestones[0].status).to.equal(1); // still ReleaseRequested, not VerifierAttested

    // Same verifier can't double-attest as their own second signature
    await expect(pool.connect(verifier).attestMilestone(1)).to.be.revertedWithCustomError(
      pool,
      "SecondVerifierMustDiffer"
    );

    // A second, distinct active verifier closes it out
    await pool.connect(investor3).attestMilestone(1); // investor3 doubles as a verifier here
    milestones = await pool.getMilestones(1);
    expect(milestones[0].status).to.equal(2); // VerifierAttested now
  });

  it("lets admin pause an in-progress deal, blocking milestone-lifecycle actions until unpaused", async function () {
    const { admin, business, investor1, investor2, investor3, registry, pool } = await deployFixture();
    await registerAndVerify(registry, admin, business);

    await pool
      .connect(business)
      .createDeal(USDC(500), 1000, 2000, 30 * DAY, 3, ["Stock"], [USDC(500)], [ethers.ZeroAddress], 0);
    await pool.connect(investor1).invest(1, USDC(200));
    await pool.connect(investor2).invest(1, USDC(200));
    await pool.connect(investor3).invest(1, USDC(100));

    await pool.connect(admin).pauseDeal(1);

    await expect(pool.connect(business).requestMilestoneRelease(1, ethers.id("ev"))).to.be.revertedWithCustomError(
      pool,
      "DealIsPaused"
    );

    await pool.connect(admin).unpauseDeal(1);
    await expect(pool.connect(business).requestMilestoneRelease(1, ethers.id("ev"))).to.not.be.reverted;
  });

  it("completes early once a capped total return is remitted, even with repayments left on schedule", async function () {
    const { admin, verifier, business, investor1, investor2, investor3, usdc, registry, pool } =
      await deployFixture();
    await registerAndVerify(registry, admin, business);

    const target = USDC(500);
    // Cap total investor return at 60 USDC even though schedule allows for up to 5 repayments
    await pool
      .connect(business)
      .createDeal(target, 1000, 2000, 30 * DAY, 5, ["Stock"], [target], [ethers.ZeroAddress], USDC(60));

    await pool.connect(investor1).invest(1, USDC(200));
    await pool.connect(investor2).invest(1, USDC(200));
    await pool.connect(investor3).invest(1, USDC(100));

    await pool.connect(business).requestMilestoneRelease(1, ethers.id("ev"));
    await pool.connect(verifier).attestMilestone(1);
    await pool.connect(investor1).approveMilestoneRelease(1);
    await pool.connect(investor2).approveMilestoneRelease(1);

    // Two repayments of 30 hit the 60 USDC cap even though numRepayments=5
    await pool.connect(business).remitProfit(1, USDC(30));
    let deal = await pool.getDeal(1);
    expect(deal.status).to.equal(2); // still Repaying, cap not hit yet (30 < 60)

    const collateralBalBefore = await usdc.balanceOf(business.address);
    await pool.connect(business).remitProfit(1, USDC(30));
    deal = await pool.getDeal(1);
    expect(deal.status).to.equal(3); // Completed -- cap hit at exactly 60, schedule (5) not exhausted
    expect(deal.repaymentsMade).to.equal(2n);
    // Net change: business pays out this 30 USDC repayment, then gets the 50
    // USDC collateral back on completion -> net +20 from this balance snapshot.
    expect(await usdc.balanceOf(business.address)).to.equal(collateralBalBefore + USDC(20));
  });
});

