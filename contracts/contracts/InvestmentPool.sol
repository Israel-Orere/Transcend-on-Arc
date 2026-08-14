// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BusinessRegistry} from "./BusinessRegistry.sol";

/// @title InvestmentPool
/// @notice Transcend's escrow + deal engine: lets investors fund a verified
/// MSME's working capital on a profit-share basis, without handing the full
/// raise to the business up front.
///
/// Built for Arc (docs.arc.io). Denominated in Arc's USDC ERC-20 interface
/// (6 decimals). Sub-second finality means an investor's approval or a
/// business's repayment settles immediately -- no multi-day float sitting
/// between "investor sent money" and "it's actually secured."
///
/// Safety model (four independent layers):
///  1. Identity  -- only businesses verified in BusinessRegistry can raise.
///  2. Collateral -- the business posts a USDC bond before any investor money
///     moves; forfeited to investors pro-rata on default.
///  3. Milestones -- capital releases in tranches the business must justify
///     with an evidence hash and the funding investors must approve
///     (weighted by contribution), never as a single lump sum.
///  4. Reputation -- completed deals raise a business's future raise cap;
///     a default freezes it and requires manual admin review to lift.
contract InvestmentPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    BusinessRegistry public immutable registry;
    address public admin;

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MIN_COLLATERAL_BPS = 1_000;
    uint16 public constant MAX_COLLATERAL_BPS = 5_000;
    uint256 public constant MAX_MILESTONES = 10;

    /// @notice Approval threshold, in bps of raised weight, required to
    /// release a milestone tranche. The bar is deliberately higher when the
    /// payee is NOT a traceable on-chain-verified business -- that's the
    /// moment money actually exits the system we can monitor, so investors
    /// must be substantially more convinced before it's allowed to happen.
    uint256 public constant MAJORITY_BPS = 5_001; // traceable payee: registered supplier who confirmed receipt
    uint256 public constant SUPERMAJORITY_BPS = 6_667; // untraceable payee: business itself, or any unregistered wallet
    uint256 public raisingWindowSeconds = 30 days;
    uint256 public defaultGracePeriodSeconds = 7 days;

    /// @notice A deal only activates once funded by at least this many
    /// distinct investors, and no single investor may hold more than
    /// MAX_INVESTOR_SHARE_BPS of the raise. Together these force a business
    /// (or a colluding party) to control at least 3 independently-funded
    /// wallets to dominate the milestone-approval vote -- real Sybil
    /// resistance on the investor side requires investor KYC, which is a
    /// deliberate scope decision left for a production launch, but this
    /// meaningfully raises the cost/visibility of a self-funding attack today.
    uint256 public constant MIN_INVESTORS = 3;
    uint256 public constant MAX_INVESTOR_SHARE_BPS = 4_000; // 40%

    /// @notice Milestones at or above this USDC amount require attestation
    /// from TWO independent verifiers, not one -- larger disbursements get
    /// more scrutiny, mirroring a multisignature-committee requirement for
    /// high-value releases. Admin-configurable per deployment/market.
    uint256 public largeMilestoneThresholdUSDC = 1_000 * 10 ** 6; // 1,000 USDC default

    enum DealStatus {
        Raising,
        Active, // fully funded, milestones being released
        Repaying, // all milestones released, profit-share remittances due
        Completed,
        Defaulted,
        Cancelled
    }

    enum MilestoneStatus {
        Pending,
        ReleaseRequested, // business submitted evidence, awaiting independent verifier
        VerifierAttested, // an independent verifier confirmed the evidence; investors may now vote
        Released
    }

    struct Milestone {
        string description;
        uint256 amount; // 6-decimal USDC tranche
        address payee; // if non-zero, funds pay this address directly (e.g. a named supplier) instead of the business
        bool payeeIsOnChainVerified; // snapshotted at creation: was `payee` a verified BusinessRegistry entry?
        bool payeeConfirmed; // set when an on-chain-verified payee independently confirms receipt
        MilestoneStatus status;
        bytes32 evidenceHash; // hash of off-chain proof (receipts, photos, invoices)
        address verifier; // first independent verifier who attested this milestone
        address verifier2; // second verifier, only required/used for large milestones (see LARGE_MILESTONE_THRESHOLD)
        uint256 approvalWeight; // sum of investor contribution-weight approving release
    }

    struct Deal {
        uint256 id;
        address business;
        uint256 targetAmount;
        uint256 raisedAmount;
        uint256 collateralAmount;
        bool collateralPosted;
        bool collateralReturned;
        uint16 profitShareBps;
        uint32 repaymentIntervalSeconds;
        uint16 numRepayments;
        uint16 repaymentsMade;
        uint256 nextRepaymentDue;
        uint256 currentMilestoneIndex;
        uint256 releasedAmount;
        DealStatus status;
        uint256 createdAt;
        uint256 raisingDeadline;
        uint256 accDistPerShare; // scaled 1e18, cumulative USDC distributed per unit contributed
        address assignedVerifier; // if set, ONLY this verifier may attest this deal's milestones
        uint256 repaymentCapUSDC; // 0 = uncapped (use numRepayments only); else deal completes once totalRemittedUSDC hits this
        uint256 totalRemittedUSDC; // cumulative profit/revenue-share remitted so far
        bool paused; // admin emergency brake: blocks milestone-lifecycle progression while true
    }

    /// @notice A merchant cannot choose an arbitrary repayment amount. For
    /// each reporting period it commits the observed gross collections and
    /// evidence hash; an independent verifier attests that off-chain data;
    /// then the contract computes the revenue share from `profitShareBps`.
    /// The legacy field name is retained for storage/API compatibility, but
    /// it represents a capped share of verified collections, not accounting
    /// profit declared by the merchant.
    struct RevenueReport {
        uint16 period;
        uint256 grossRevenueUSDC;
        uint256 amountDueUSDC;
        bytes32 evidenceHash;
        address verifier;
        uint64 submittedAt;
        bool attested;
        bool settled;
    }

    uint256 private _nextDealId = 1;

    mapping(uint256 => Deal) public deals;
    mapping(uint256 => Milestone[]) public dealMilestones;
    mapping(uint256 => mapping(address => uint256)) public investorContribution;
    mapping(uint256 => mapping(address => uint256)) public investorDebt; // for pull-based distribution accounting
    mapping(uint256 => mapping(address => bool)) public hasApprovedMilestone; // per (dealId*1000+milestoneIdx) style key avoided; see approvals mapping below
    mapping(uint256 => address[]) public dealInvestorList;
    mapping(uint256 => mapping(uint16 => RevenueReport)) public revenueReports;

    // approvals[dealId][milestoneIndex][investor] = approved?
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public milestoneApprovals;

    // Global uniqueness: the same proof cannot justify two different releases.
    mapping(bytes32 => bool) public evidenceHashUsed;

    event DealCreated(uint256 indexed dealId, address indexed business, uint256 targetAmount, uint256 collateralAmount);
    event Invested(uint256 indexed dealId, address indexed investor, uint256 amount, uint256 raisedAmount);
    event DealFullyFunded(uint256 indexed dealId);
    event MilestoneReleaseRequested(uint256 indexed dealId, uint256 indexed milestoneIndex, bytes32 evidenceHash);
    event MilestoneVerifierAttested(uint256 indexed dealId, uint256 indexed milestoneIndex, address indexed verifier);
    event MilestonePayeeConfirmed(uint256 indexed dealId, uint256 indexed milestoneIndex, address indexed payee);
    event MilestoneApproved(uint256 indexed dealId, uint256 indexed milestoneIndex, address indexed investor, uint256 approvalWeight);
    event MilestoneReleased(uint256 indexed dealId, uint256 indexed milestoneIndex, uint256 amount);
    event DealActivated(uint256 indexed dealId);
    event RevenueReportSubmitted(
        uint256 indexed dealId,
        uint16 indexed period,
        uint256 grossRevenueUSDC,
        uint256 amountDueUSDC,
        bytes32 evidenceHash
    );
    event RevenueReportAttested(uint256 indexed dealId, uint16 indexed period, address indexed verifier);
    event RevenueShareSettled(uint256 indexed dealId, uint16 indexed period, uint256 amount, uint16 repaymentsMade);
    event DealCompleted(uint256 indexed dealId);
    event DealDefaulted(uint256 indexed dealId, uint256 forfeitedCollateral, uint256 undisbursedEscrow);
    event DealCancelled(uint256 indexed dealId);
    event Withdrawn(uint256 indexed dealId, address indexed investor, uint256 amount);
    event CollateralReturned(uint256 indexed dealId, address indexed business, uint256 amount);
    event VerifierAssigned(uint256 indexed dealId, address indexed verifier);
    event DealPaused(uint256 indexed dealId);
    event DealUnpaused(uint256 indexed dealId);

    error NotAdmin();
    error CannotRaise();
    error ExceedsRaiseCap();
    error InvalidMilestones();
    error DealNotFound();
    error WrongStatus();
    error NotBusinessOwner();
    error NotInvestor();
    error ZeroAmount();
    error RaiseStillOpen();
    error RaiseWindowExpired();
    error AlreadyApproved();
    error RepaymentNotDue();
    error NotYetDefaultable();
    error NothingToWithdraw();
    error NotActiveVerifier();
    error BusinessCannotInvestOwnDeal();
    error ExceedsInvestorShareCap();
    error NotEnoughInvestors();
    error EvidenceHashReused();
    error NotAssignedVerifier();
    error DealIsPaused();
    error SecondVerifierMustDiffer();
    error RevenueReportMissing();
    error RevenueReportAlreadyExists();
    error RevenueReportNotAttested();
    error RevenueReportAlreadySettled();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address usdcToken, address registryAddress, address admin_) {
        usdc = IERC20(usdcToken);
        registry = BusinessRegistry(registryAddress);
        admin = admin_ == address(0) ? msg.sender : admin_;
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        admin = newAdmin;
    }

    function setTimings(uint256 raisingWindowSeconds_, uint256 defaultGracePeriodSeconds_) external onlyAdmin {
        raisingWindowSeconds = raisingWindowSeconds_;
        defaultGracePeriodSeconds = defaultGracePeriodSeconds_;
    }

    /// @notice Admin assigns a specific verifier to a deal, so that verifier
    /// -- and only that verifier -- can attest its milestones. Prevents a
    /// colluding verifier from self-selecting friendly deals out of the open
    /// pool. Optional: if left unset, any active verifier may attest
    /// (fallback for early-stage platforms without enough dedicated capacity).
    function assignVerifier(uint256 dealId, address verifier) external onlyAdmin {
        Deal storage d = _getDeal(dealId);
        d.assignedVerifier = verifier;
        emit VerifierAssigned(dealId, verifier);
    }

    function setLargeMilestoneThreshold(uint256 amount) external onlyAdmin {
        largeMilestoneThresholdUSDC = amount;
    }

    /// @notice Emergency brake: freezes an in-progress deal's milestone
    /// lifecycle (requests, attestations, confirmations, approvals) the
    /// moment a fraud signal appears, without waiting for a full default.
    /// Investors can still withdraw anything already owed to them; the
    /// repayment clock is not stopped, so use judgment on when to unpause.
    function pauseDeal(uint256 dealId) external onlyAdmin {
        Deal storage d = _getDeal(dealId);
        d.paused = true;
        emit DealPaused(dealId);
    }

    function unpauseDeal(uint256 dealId) external onlyAdmin {
        Deal storage d = _getDeal(dealId);
        d.paused = false;
        emit DealUnpaused(dealId);
    }

    // ---------- Deal creation ----------

    /// @notice Create a raise. The business must immediately post the
    /// collateral bond (pulled from msg.sender in this same call) before any
    /// investor can contribute -- proof of skin in the game up front.
    function createDeal(
        uint256 targetAmount,
        uint16 collateralBps,
        uint16 profitShareBps,
        uint32 repaymentIntervalSeconds,
        uint16 numRepayments,
        string[] calldata milestoneDescriptions,
        uint256[] calldata milestoneAmounts,
        address[] calldata milestonePayees,
        uint256 repaymentCapUSDC
    ) external nonReentrant returns (uint256 dealId) {
        if (!registry.canRaise(msg.sender)) revert CannotRaise();
        if (
            targetAmount == 0 || collateralBps < MIN_COLLATERAL_BPS || collateralBps > MAX_COLLATERAL_BPS
                || profitShareBps == 0 || profitShareBps > BPS_DENOMINATOR || repaymentIntervalSeconds == 0
                || numRepayments == 0
        ) revert InvalidMilestones();
        if (targetAmount > registry.raiseCap(msg.sender)) revert ExceedsRaiseCap();
        if (
            milestoneDescriptions.length == 0 ||
            milestoneDescriptions.length > MAX_MILESTONES ||
            milestoneDescriptions.length != milestoneAmounts.length ||
            milestoneDescriptions.length != milestonePayees.length
        ) revert InvalidMilestones();

        uint256 sum;
        for (uint256 i = 0; i < milestoneAmounts.length; i++) {
            if (milestoneAmounts[i] == 0) revert InvalidMilestones();
            sum += milestoneAmounts[i];
        }
        if (sum != targetAmount) revert InvalidMilestones();

        dealId = _nextDealId++;
        uint256 collateralAmount = (targetAmount * collateralBps) / BPS_DENOMINATOR;

        Deal storage d = deals[dealId];
        d.id = dealId;
        d.business = msg.sender;
        d.targetAmount = targetAmount;
        d.collateralAmount = collateralAmount;
        d.profitShareBps = profitShareBps;
        d.repaymentIntervalSeconds = repaymentIntervalSeconds;
        d.numRepayments = numRepayments;
        d.status = DealStatus.Raising;
        d.createdAt = block.timestamp;
        d.raisingDeadline = block.timestamp + raisingWindowSeconds;
        d.repaymentCapUSDC = repaymentCapUSDC;

        for (uint256 i = 0; i < milestoneDescriptions.length; i++) {
            bool payeeVerified = milestonePayees[i] != address(0) && registry.canRaise(milestonePayees[i]);
            dealMilestones[dealId].push(
                Milestone({
                    description: milestoneDescriptions[i],
                    amount: milestoneAmounts[i],
                    payee: milestonePayees[i],
                    payeeIsOnChainVerified: payeeVerified,
                    payeeConfirmed: false,
                    status: MilestoneStatus.Pending,
                    evidenceHash: bytes32(0),
                    verifier: address(0),
                    verifier2: address(0),
                    approvalWeight: 0
                })
            );
        }

        usdc.safeTransferFrom(msg.sender, address(this), collateralAmount);
        d.collateralPosted = true;

        emit DealCreated(dealId, msg.sender, targetAmount, collateralAmount);
    }

    // ---------- Funding ----------

    function invest(uint256 dealId, uint256 amount) external nonReentrant {
        Deal storage d = _getDeal(dealId);
        if (d.status != DealStatus.Raising) revert WrongStatus();
        if (block.timestamp > d.raisingDeadline) revert RaiseWindowExpired();
        if (amount == 0) revert ZeroAmount();
        if (msg.sender == d.business) revert BusinessCannotInvestOwnDeal();
        if (d.raisedAmount + amount > d.targetAmount) revert ExceedsRaiseCap();

        if (investorContribution[dealId][msg.sender] == 0) {
            dealInvestorList[dealId].push(msg.sender);
        }
        investorContribution[dealId][msg.sender] += amount;
        if (investorContribution[dealId][msg.sender] * BPS_DENOMINATOR > d.targetAmount * MAX_INVESTOR_SHARE_BPS) {
            revert ExceedsInvestorShareCap();
        }
        d.raisedAmount += amount;

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit Invested(dealId, msg.sender, amount, d.raisedAmount);

        if (d.raisedAmount == d.targetAmount) {
            if (dealInvestorList[dealId].length < MIN_INVESTORS) revert NotEnoughInvestors();
            d.status = DealStatus.Active;
            registry.recordDealFunded(d.business, d.raisedAmount);
            emit DealFullyFunded(dealId);
        }
    }

    /// @notice If a raise doesn't fill within the raising window, business or
    /// any investor can cancel. Contributed funds and posted collateral both
    /// return in full -- nothing was ever put at risk.
    function cancelUnfundedDeal(uint256 dealId) external nonReentrant {
        Deal storage d = _getDeal(dealId);
        if (d.status != DealStatus.Raising) revert WrongStatus();
        if (block.timestamp <= d.raisingDeadline && msg.sender != d.business) revert RaiseStillOpen();

        d.status = DealStatus.Cancelled;
        if (d.raisedAmount > 0) {
            d.accDistPerShare += (d.raisedAmount * 1e18) / d.raisedAmount; // = 1e18, i.e. full refund pro rata
        }
        emit DealCancelled(dealId);

        if (d.collateralPosted && d.collateralAmount > 0 && !d.collateralReturned) {
            d.collateralReturned = true;
            usdc.safeTransfer(d.business, d.collateralAmount);
            emit CollateralReturned(dealId, d.business, d.collateralAmount);
        }
    }

    // ---------- Milestones ----------

    /// @notice Business submits evidence that a milestone's work is done.
    function requestMilestoneRelease(uint256 dealId, bytes32 evidenceHash) external {
        Deal storage d = _getDeal(dealId);
        if (msg.sender != d.business) revert NotBusinessOwner();
        if (d.paused) revert DealIsPaused();
        if (d.status != DealStatus.Active) revert WrongStatus();

        Milestone storage m = dealMilestones[dealId][d.currentMilestoneIndex];
        if (m.status != MilestoneStatus.Pending) revert WrongStatus();
        if (evidenceHashUsed[evidenceHash]) revert EvidenceHashReused();

        evidenceHashUsed[evidenceHash] = true;
        m.status = MilestoneStatus.ReleaseRequested;
        m.evidenceHash = evidenceHash;

        emit MilestoneReleaseRequested(dealId, d.currentMilestoneIndex, evidenceHash);
    }

    /// @notice An independent, registry-appointed verifier attests that it
    /// checked the submitted evidence. Required before investors can vote.
    /// The verifier's own on-chain track record accumulates with each call.
    /// If the deal has an assigned verifier, that address must give the
    /// FIRST attestation. Milestones at or above `largeMilestoneThresholdUSDC`
    /// additionally require a second, distinct active verifier before
    /// investors can vote -- a lightweight multisignature-committee rule for
    /// high-value releases.
    function attestMilestone(uint256 dealId) external {
        if (!registry.isActiveVerifier(msg.sender)) revert NotActiveVerifier();
        Deal storage d = _getDeal(dealId);
        if (d.paused) revert DealIsPaused();
        if (d.status != DealStatus.Active) revert WrongStatus();

        uint256 idx = d.currentMilestoneIndex;
        Milestone storage m = dealMilestones[dealId][idx];
        if (m.status != MilestoneStatus.ReleaseRequested) revert WrongStatus();

        bool needsSecond = m.amount >= largeMilestoneThresholdUSDC;

        if (m.verifier == address(0)) {
            if (d.assignedVerifier != address(0) && msg.sender != d.assignedVerifier) revert NotAssignedVerifier();
            m.verifier = msg.sender;
            registry.recordVerifierAttestation(msg.sender);
            emit MilestoneVerifierAttested(dealId, idx, msg.sender);
            if (!needsSecond) {
                m.status = MilestoneStatus.VerifierAttested;
            }
        } else {
            if (msg.sender == m.verifier) revert SecondVerifierMustDiffer();
            m.verifier2 = msg.sender;
            registry.recordVerifierAttestation(msg.sender);
            emit MilestoneVerifierAttested(dealId, idx, msg.sender);
            m.status = MilestoneStatus.VerifierAttested;
        }
    }

    /// @notice If this milestone's payee is itself a verified on-chain
    /// business, that payee must independently confirm receipt before
    /// investors can vote -- a second, non-fakeable confirmation from a party
    /// with no reason to collude with the borrower.
    function confirmReceipt(uint256 dealId) external {
        Deal storage d = _getDeal(dealId);
        if (d.paused) revert DealIsPaused();
        uint256 idx = d.currentMilestoneIndex;
        Milestone storage m = dealMilestones[dealId][idx];
        if (msg.sender != m.payee) revert NotBusinessOwner();

        m.payeeConfirmed = true;
        emit MilestonePayeeConfirmed(dealId, idx, msg.sender);
    }

    function _milestoneReadyForVote(Milestone storage m) internal view returns (bool) {
        if (m.status != MilestoneStatus.VerifierAttested) return false;
        if (m.payeeIsOnChainVerified && !m.payeeConfirmed) return false;
        return true;
    }

    /// @notice An investor in this specific deal approves releasing the
    /// current milestone tranche. Requires the verifier (and, if the payee is
    /// itself an on-chain verified business, the payee too) to have already
    /// confirmed. Once approvals represent a majority of the raised amount
    /// (by contribution weight), the tranche releases immediately.
    function approveMilestoneRelease(uint256 dealId) external nonReentrant {
        Deal storage d = _getDeal(dealId);
        if (d.paused) revert DealIsPaused();
        uint256 weight = investorContribution[dealId][msg.sender];
        if (weight == 0) revert NotInvestor();
        if (d.status != DealStatus.Active) revert WrongStatus();

        uint256 idx = d.currentMilestoneIndex;
        Milestone storage m = dealMilestones[dealId][idx];
        if (!_milestoneReadyForVote(m)) revert WrongStatus();
        if (milestoneApprovals[dealId][idx][msg.sender]) revert AlreadyApproved();

        milestoneApprovals[dealId][idx][msg.sender] = true;
        m.approvalWeight += weight;

        emit MilestoneApproved(dealId, idx, msg.sender, m.approvalWeight);

        // Traceable payee (on-chain-verified supplier who confirmed receipt)
        // releases at simple majority; anything that exits to an untraceable
        // wallet (the business itself, or any unregistered address) needs a
        // supermajority -- the approval bar rises exactly at the point where
        // we lose the ability to follow the money.
        uint256 requiredBps = (m.payeeIsOnChainVerified && m.payeeConfirmed) ? MAJORITY_BPS : SUPERMAJORITY_BPS;
        if (m.approvalWeight * BPS_DENOMINATOR >= d.raisedAmount * requiredBps) {
            _releaseMilestone(dealId, d, idx, m);
        }
    }

    function _releaseMilestone(uint256 dealId, Deal storage d, uint256 idx, Milestone storage m) internal {
        m.status = MilestoneStatus.Released;
        d.releasedAmount += m.amount;

        address recipient = m.payee != address(0) ? m.payee : d.business;
        bool traceable = m.payeeIsOnChainVerified && m.payeeConfirmed;
        registry.recordDisbursement(d.business, m.amount, traceable);
        usdc.safeTransfer(recipient, m.amount);
        emit MilestoneReleased(dealId, idx, m.amount);

        if (idx + 1 == dealMilestones[dealId].length) {
            d.status = DealStatus.Repaying;
            d.nextRepaymentDue = block.timestamp + d.repaymentIntervalSeconds;
            emit DealActivated(dealId);
        } else {
            d.currentMilestoneIndex += 1;
        }
    }

    // ---------- Verified revenue reporting / investor distribution ----------

    function submitRevenueReport(uint256 dealId, uint256 grossRevenueUSDC, bytes32 evidenceHash) external {
        Deal storage d = _getDeal(dealId);
        if (msg.sender != d.business) revert NotBusinessOwner();
        if (d.status != DealStatus.Repaying) revert WrongStatus();
        if (d.paused) revert DealIsPaused();
        if (grossRevenueUSDC == 0) revert ZeroAmount();
        if (evidenceHash == bytes32(0) || evidenceHashUsed[evidenceHash]) revert EvidenceHashReused();

        uint16 period = d.repaymentsMade + 1;
        RevenueReport storage report = revenueReports[dealId][period];
        if (report.submittedAt != 0) revert RevenueReportAlreadyExists();

        uint256 amountDue = (grossRevenueUSDC * d.profitShareBps) / BPS_DENOMINATOR;
        if (d.repaymentCapUSDC > 0) {
            uint256 remaining = d.repaymentCapUSDC > d.totalRemittedUSDC
                ? d.repaymentCapUSDC - d.totalRemittedUSDC
                : 0;
            if (amountDue > remaining) amountDue = remaining;
        }
        if (amountDue == 0) revert ZeroAmount();

        evidenceHashUsed[evidenceHash] = true;
        revenueReports[dealId][period] = RevenueReport({
            period: period,
            grossRevenueUSDC: grossRevenueUSDC,
            amountDueUSDC: amountDue,
            evidenceHash: evidenceHash,
            verifier: address(0),
            submittedAt: uint64(block.timestamp),
            attested: false,
            settled: false
        });

        emit RevenueReportSubmitted(dealId, period, grossRevenueUSDC, amountDue, evidenceHash);
    }

    function attestRevenueReport(uint256 dealId) external {
        if (!registry.isActiveVerifier(msg.sender)) revert NotActiveVerifier();
        Deal storage d = _getDeal(dealId);
        if (d.status != DealStatus.Repaying) revert WrongStatus();
        if (d.paused) revert DealIsPaused();
        if (d.assignedVerifier != address(0) && msg.sender != d.assignedVerifier) revert NotAssignedVerifier();

        uint16 period = d.repaymentsMade + 1;
        RevenueReport storage report = revenueReports[dealId][period];
        if (report.submittedAt == 0) revert RevenueReportMissing();
        if (report.attested) revert AlreadyApproved();

        report.attested = true;
        report.verifier = msg.sender;
        registry.recordVerifierAttestation(msg.sender);
        emit RevenueReportAttested(dealId, period, msg.sender);
    }

    /// @notice Transfers the exact contract-calculated share of independently
    /// attested gross collections. The merchant cannot lower the payment after
    /// the report is accepted. Investors receive funds through pull accounting.
    function settleRevenueShare(uint256 dealId) external nonReentrant {
        Deal storage d = _getDeal(dealId);
        if (msg.sender != d.business) revert NotBusinessOwner();
        if (d.status != DealStatus.Repaying) revert WrongStatus();
        if (d.paused) revert DealIsPaused();

        uint16 period = d.repaymentsMade + 1;
        RevenueReport storage report = revenueReports[dealId][period];
        if (report.submittedAt == 0) revert RevenueReportMissing();
        if (!report.attested) revert RevenueReportNotAttested();
        if (report.settled) revert RevenueReportAlreadySettled();

        uint256 amount = report.amountDueUSDC;
        report.settled = true;

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        d.accDistPerShare += (amount * 1e18) / d.raisedAmount;
        d.repaymentsMade += 1;
        d.totalRemittedUSDC += amount;
        d.nextRepaymentDue = block.timestamp + d.repaymentIntervalSeconds;

        registry.recordRepayment(d.business, amount);
        emit RevenueShareSettled(dealId, period, amount, d.repaymentsMade);

        // Completes on whichever comes first: the repayment schedule
        // finishing, or (if set) hitting the capped total return -- giving
        // investors a clear ceiling on what they'll ever collect, per a
        // capped-revenue-share structure rather than open-ended profit share.
        bool scheduleDone = d.repaymentsMade >= d.numRepayments;
        bool capHit = d.repaymentCapUSDC > 0 && d.totalRemittedUSDC >= d.repaymentCapUSDC;
        if (scheduleDone || capHit) {
            d.status = DealStatus.Completed;
            registry.recordDealCompleted(d.business);
            emit DealCompleted(dealId);

            if (d.collateralPosted && d.collateralAmount > 0 && !d.collateralReturned) {
                d.collateralReturned = true;
                usdc.safeTransfer(d.business, d.collateralAmount);
                emit CollateralReturned(dealId, d.business, d.collateralAmount);
            }
        }
    }

    /// @notice Permissionless "poke": anyone can call this once a repayment is
    /// overdue past the grace period. Flips the deal to Defaulted, dents the
    /// business's on-chain reputation, forfeits its collateral to investors,
    /// and unlocks reclaim of any escrow that was never released.
    function checkDefault(uint256 dealId) external nonReentrant {
        Deal storage d = _getDeal(dealId);
        if (d.status != DealStatus.Repaying) revert WrongStatus();
        if (block.timestamp <= d.nextRepaymentDue + defaultGracePeriodSeconds) revert NotYetDefaultable();

        d.status = DealStatus.Defaulted;
        registry.recordDealDefaulted(d.business);

        // Accountability loop: any verifier who attested a milestone on this
        // deal gets that attestation linked to a default, denting their own
        // on-chain track record.
        Milestone[] storage milestones = dealMilestones[dealId];
        for (uint256 i = 0; i < milestones.length; i++) {
            if (milestones[i].verifier != address(0)) {
                registry.recordVerifierDefaultLink(milestones[i].verifier);
            }
            if (milestones[i].verifier2 != address(0)) {
                registry.recordVerifierDefaultLink(milestones[i].verifier2);
            }
        }
        RevenueReport storage currentReport = revenueReports[dealId][d.repaymentsMade + 1];
        if (currentReport.verifier != address(0)) {
            registry.recordVerifierDefaultLink(currentReport.verifier);
        }

        uint256 undisbursed = d.targetAmount - d.releasedAmount; // always 0 once fully released, kept for safety
        uint256 forfeitedCollateral = 0;
        if (d.collateralPosted && d.collateralAmount > 0 && !d.collateralReturned) {
            d.collateralReturned = true; // "returned" flag also guards the forfeiture payout below from re-firing
            forfeitedCollateral = d.collateralAmount;
        }

        uint256 distributable = undisbursed + forfeitedCollateral;
        if (distributable > 0) {
            d.accDistPerShare += (distributable * 1e18) / d.raisedAmount;
        }

        emit DealDefaulted(dealId, forfeitedCollateral, undisbursed);
    }

    // ---------- Withdrawals ----------

    /// @notice Pull-based withdrawal of everything owed to the caller for a
    /// deal: profit-share distributions, and (if applicable) their pro-rata
    /// slice of forfeited collateral / reclaimed escrow / a cancellation refund.
    function withdraw(uint256 dealId) external nonReentrant {
        Deal storage d = _getDeal(dealId);
        uint256 contribution = investorContribution[dealId][msg.sender];
        if (contribution == 0) revert NotInvestor();

        uint256 owed = (contribution * d.accDistPerShare) / 1e18;
        uint256 alreadyPaid = investorDebt[dealId][msg.sender];
        if (owed <= alreadyPaid) revert NothingToWithdraw();

        uint256 pending = owed - alreadyPaid;
        investorDebt[dealId][msg.sender] = owed;

        usdc.safeTransfer(msg.sender, pending);
        emit Withdrawn(dealId, msg.sender, pending);
    }

    function pendingWithdrawal(uint256 dealId, address investor) external view returns (uint256) {
        Deal storage d = deals[dealId];
        uint256 contribution = investorContribution[dealId][investor];
        if (contribution == 0) return 0;
        uint256 owed = (contribution * d.accDistPerShare) / 1e18;
        uint256 alreadyPaid = investorDebt[dealId][investor];
        return owed > alreadyPaid ? owed - alreadyPaid : 0;
    }

    // ---------- Views ----------

    function _getDeal(uint256 dealId) internal view returns (Deal storage) {
        Deal storage d = deals[dealId];
        if (d.id == 0) revert DealNotFound();
        return d;
    }

    function getDeal(uint256 dealId) external view returns (Deal memory) {
        return deals[dealId];
    }

    function getMilestones(uint256 dealId) external view returns (Milestone[] memory) {
        return dealMilestones[dealId];
    }

    function getDealInvestors(uint256 dealId) external view returns (address[] memory) {
        return dealInvestorList[dealId];
    }

    function getRevenueReport(uint256 dealId, uint16 period) external view returns (RevenueReport memory) {
        return revenueReports[dealId][period];
    }

    function nextDealId() external view returns (uint256) {
        return _nextDealId;
    }
}
