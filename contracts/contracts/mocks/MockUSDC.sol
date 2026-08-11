// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 6-decimal mock USDC used ONLY for local Hardhat tests, mirroring
/// the decimals of Arc's real USDC ERC-20 interface at
/// 0x3600000000000000000000000000000000000000. Never deployed to Arc --
/// on Arc, DukaPay is pointed at the real USDC contract instead.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
