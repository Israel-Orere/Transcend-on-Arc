// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BusinessRegistry
/// @notice On-chain identity and track record for MSMEs raising capital on
/// Transcend. This is the "credibility layer" that the original off-chain
/// Transcend concept lacked: instead of asking an investor to trust a pitch
/// deck, a business's raise limit is earned deal-by-deal from a public,
/// tamper-evident history that lives on Arc.
///
/// Two anti-fraud properties are enforced here that matter more than the
/// bookkeeping itself:
///  1. Verification gate -- a business can create a `Business` profile freely,
///     but cannot raise any capital until a verifier attests it reviewed the
///     business's real-world registration documents (e.g. Nigeria's CAC).
///  2. Sybil resistance -- the hash of a business's registration number can
///     only ever be bound to one wallet address, so a business that defaults
///     cannot simply re-register under a new address and start over.
contract BusinessRegistry {
    enum ReputationTier {
        Unverified, // registered but not yet KYC/document-verified -- cannot raise
        New, // verified, no completed deals yet -- smallest raise cap
        Trusted, // 1-2 completed deals, no defaults
        Established // 3+ completed deals, no defaults -- highest raise cap
    }

    struct Business {
        bool registered;
        bool verified;
        bool frozen; // set true on default; blocks new raises until admin review
        address owner;
        string businessName;
        string category;
        string city;
        string country;
        bytes32 regNumberHash; // keccak256 of e.g. CAC registration number, kept off-chain in plaintext
        uint256 completedDeals;
        uint256 defaultedDeals;
        uint256 totalRaisedUSDC;
        uint256 totalRepaidUSDC;
        uint256 disbursedToTraceablePayeeUSDC; // released to a registered on-chain business (confirmed receipt)
        uint256 disbursedToUntraceablePayeeUSDC; // released to the business itself or an unregistered wallet
    }

    address public admin;
    // Contracts (e.g. InvestmentPool) authorized to record deal outcomes.
    mapping(address => bool) public authorizedPools;

    mapping(address => Business) public businesses;
    address[] public businessList;
    mapping(bytes32 => address) public regNumberToAddress; // Sybil-resistance

    /// @notice Independent verifiers: neutral parties (field agents, local
    /// accounting partners, community organizers) who physically check a
    /// business's evidence before investors ever get to vote on releasing
    /// money. Kept separate from `admin` so verification work can be
    /// delegated without handing out full protocol control.
    struct Verifier {
        bool active;
        string name;
        uint256 attestationsGiven;
        uint256 attestationsLinkedToDefault; // attestations whose deal later defaulted
    }

    mapping(address => Verifier) public verifiers;

    event VerifierAdded(address indexed verifier, string name);
    event VerifierRemoved(address indexed verifier);
    event VerifierAttestationRecorded(address indexed verifier);
    event VerifierDefaultLinked(address indexed verifier);

    error NotActiveVerifier();

    // Raise caps in USDC (6 decimals) by reputation tier. Admin-tunable so caps
    // can be calibrated as real default-rate data comes in.
    mapping(ReputationTier => uint256) public raiseCapByTier;

    event AdminChanged(address indexed newAdmin);
    event PoolAuthorized(address indexed pool, bool authorized);
    event BusinessRegistered(address indexed business, string businessName, bytes32 regNumberHash);
    event BusinessVerified(address indexed business, address indexed verifier);
    event BusinessFrozen(address indexed business);
    event BusinessUnfrozen(address indexed business);
    event RaiseCapUpdated(ReputationTier tier, uint256 cap);
    event DealFundedRecorded(address indexed business, uint256 amount);
    event RepaymentRecorded(address indexed business, uint256 amount);
    event DealCompletedRecorded(address indexed business);
    event DealDefaultedRecorded(address indexed business);

    error NotAdmin();
    error NotAuthorizedPool();
    error AlreadyRegistered();
    error RegNumberTaken();
    error NotRegistered();
    error AlreadyVerified();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAuthorizedPool() {
        if (!authorizedPools[msg.sender]) revert NotAuthorizedPool();
        _;
    }

    constructor(address admin_) {
        admin = admin_ == address(0) ? msg.sender : admin_;

        // Sensible defaults (6-decimal USDC). Tunable via setRaiseCap.
        raiseCapByTier[ReputationTier.Unverified] = 0;
        raiseCapByTier[ReputationTier.New] = 500_000000; // 500 USDC
        raiseCapByTier[ReputationTier.Trusted] = 2_500_000000; // 2,500 USDC
        raiseCapByTier[ReputationTier.Established] = 10_000_000000; // 10,000 USDC
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        admin = newAdmin;
        emit AdminChanged(newAdmin);
    }

    function setPoolAuthorized(address pool, bool authorized) external onlyAdmin {
        authorizedPools[pool] = authorized;
        emit PoolAuthorized(pool, authorized);
    }

    function setRaiseCap(ReputationTier tier, uint256 cap) external onlyAdmin {
        raiseCapByTier[tier] = cap;
        emit RaiseCapUpdated(tier, cap);
    }

    // ---------- Verifiers ----------

    function addVerifier(address verifier, string calldata name) external onlyAdmin {
        verifiers[verifier].active = true;
        verifiers[verifier].name = name;
        emit VerifierAdded(verifier, name);
    }

    function removeVerifier(address verifier) external onlyAdmin {
        verifiers[verifier].active = false;
        emit VerifierRemoved(verifier);
    }

    function isActiveVerifier(address verifier) external view returns (bool) {
        return verifiers[verifier].active;
    }

    function getVerifier(address verifier) external view returns (Verifier memory) {
        return verifiers[verifier];
    }

    /// @notice Called by an authorized InvestmentPool each time a verifier
    /// attests a milestone, so a verifier's track record accumulates on-chain.
    function recordVerifierAttestation(address verifier) external onlyAuthorizedPool {
        verifiers[verifier].attestationsGiven += 1;
        emit VerifierAttestationRecorded(verifier);
    }

    /// @notice Called when a deal a verifier attested for later defaults --
    /// this is the accountability signal that makes a rubber-stamping
    /// verifier visibly unreliable over time.
    function recordVerifierDefaultLink(address verifier) external onlyAuthorizedPool {
        verifiers[verifier].attestationsLinkedToDefault += 1;
        emit VerifierDefaultLinked(verifier);
    }

    /// @notice Create a business profile. Does NOT grant raise eligibility --
    /// see `verifyBusiness`.
    function registerBusiness(
        string calldata businessName,
        string calldata category,
        string calldata city,
        string calldata country,
        bytes32 regNumberHash
    ) external {
        if (businesses[msg.sender].registered) revert AlreadyRegistered();
        if (regNumberToAddress[regNumberHash] != address(0)) revert RegNumberTaken();

        businesses[msg.sender] = Business({
            registered: true,
            verified: false,
            frozen: false,
            owner: msg.sender,
            businessName: businessName,
            category: category,
            city: city,
            country: country,
            regNumberHash: regNumberHash,
            completedDeals: 0,
            defaultedDeals: 0,
            totalRaisedUSDC: 0,
            totalRepaidUSDC: 0,
            disbursedToTraceablePayeeUSDC: 0,
            disbursedToUntraceablePayeeUSDC: 0
        });
        businessList.push(msg.sender);
        regNumberToAddress[regNumberHash] = msg.sender;

        emit BusinessRegistered(msg.sender, businessName, regNumberHash);
    }

    /// @notice Admin/verifier attests it reviewed the business's real-world
    /// registration documents off-chain. Required before any deal can be created.
    function verifyBusiness(address business) external onlyAdmin {
        Business storage b = businesses[business];
        if (!b.registered) revert NotRegistered();
        if (b.verified) revert AlreadyVerified();
        b.verified = true;
        emit BusinessVerified(business, msg.sender);
    }

    /// @notice Manually unfreeze a business after a default, once an admin has
    /// reviewed what happened (e.g. dispute resolved, partial recovery agreed).
    function unfreezeBusiness(address business) external onlyAdmin {
        businesses[business].frozen = false;
        emit BusinessUnfrozen(business);
    }

    // ---------- Called by authorized InvestmentPool contracts ----------

    function recordDealFunded(address business, uint256 amount) external onlyAuthorizedPool {
        businesses[business].totalRaisedUSDC += amount;
        emit DealFundedRecorded(business, amount);
    }

    function recordRepayment(address business, uint256 amount) external onlyAuthorizedPool {
        businesses[business].totalRepaidUSDC += amount;
        emit RepaymentRecorded(business, amount);
    }

    /// @notice Called by an authorized InvestmentPool each time a milestone
    /// tranche releases, so investors can see how much of a business's
    /// capital has gone to traceable on-chain counterparties versus
    /// untraceable wallets. Purely informational -- does not gate raising.
    function recordDisbursement(address business, uint256 amount, bool traceable) external onlyAuthorizedPool {
        if (traceable) {
            businesses[business].disbursedToTraceablePayeeUSDC += amount;
        } else {
            businesses[business].disbursedToUntraceablePayeeUSDC += amount;
        }
    }

    function recordDealCompleted(address business) external onlyAuthorizedPool {
        businesses[business].completedDeals += 1;
        emit DealCompletedRecorded(business);
    }

    function recordDealDefaulted(address business) external onlyAuthorizedPool {
        Business storage b = businesses[business];
        b.defaultedDeals += 1;
        b.frozen = true;
        emit DealDefaultedRecorded(business);
        emit BusinessFrozen(business);
    }

    // ---------- Views ----------

    function reputationTier(address business) public view returns (ReputationTier) {
        Business storage b = businesses[business];
        if (!b.verified || b.frozen) return ReputationTier.Unverified;
        if (b.defaultedDeals > 0) return ReputationTier.Unverified; // any default requires manual unfreeze + review
        if (b.completedDeals >= 3) return ReputationTier.Established;
        if (b.completedDeals >= 1) return ReputationTier.Trusted;
        return ReputationTier.New;
    }

    function raiseCap(address business) external view returns (uint256) {
        return raiseCapByTier[reputationTier(business)];
    }

    function canRaise(address business) external view returns (bool) {
        Business storage b = businesses[business];
        return b.registered && b.verified && !b.frozen;
    }

    function getBusiness(address business) external view returns (Business memory) {
        return businesses[business];
    }

    function businessCount() external view returns (uint256) {
        return businessList.length;
    }
}
