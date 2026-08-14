require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const DEPLOYMENT_ACCOUNTS = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  // Contracts are compiled via `node scripts/compile.js` (pure JS solc from
  // npm) instead of Hardhat's built-in compile task, because this sandbox's
  // network egress does not allow binaries.soliditylang.org. Run
  // `npm run compile` before `npm test`. `solidity` config below is kept so
  // Hardhat's other tasks (e.g. `clean`) don't error, but is not used to compile.
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    // Arc Testnet -- Circle's USDC-native, sub-second-finality L1.
    // Gas is paid in USDC. Fund your deployer address from https://faucet.circle.com
    arcTestnet: {
      url: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io",
      chainId: 5042002,
      accounts: DEPLOYMENT_ACCOUNTS,
      // Arc enforces a 20 gwei minimum base fee (see docs.arc.network)
      gasPrice: 20_000_000_000,
    },
  },
  etherscan: {
    // Arc uses ArcScan (Blockscout-based) rather than Etherscan; verification
    // can be wired up here once an ArcScan API endpoint is published for testnet.
    enabled: false,
  },
};
