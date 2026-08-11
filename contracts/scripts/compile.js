// Compiles contracts using the npm `solc` package (pure JS/WASM, fetched
// from the npm registry, not binaries.soliditylang.org) and writes artifacts
// in Hardhat's expected format so `hre.ethers.getContractFactory` works
// normally in tests.
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const CONTRACTS_DIR = path.join(__dirname, "..", "contracts");
const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts");
const NODE_MODULES = path.join(__dirname, "..", "node_modules");

function findContracts(dir, base = dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findContracts(full, base));
    } else if (entry.name.endsWith(".sol")) {
      results.push(path.relative(base, full));
    }
  }
  return results;
}

function importCallback(importPath) {
  const candidates = [
    path.join(CONTRACTS_DIR, importPath),
    path.join(NODE_MODULES, importPath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }
  return { error: `File not found: ${importPath}` };
}

function main() {
  const relFiles = findContracts(CONTRACTS_DIR);
  const sources = {};
  for (const rel of relFiles) {
    const key = rel.split(path.sep).join("/");
    sources[key] = { content: fs.readFileSync(path.join(CONTRACTS_DIR, rel), "utf8") };
  }

  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: importCallback }));

  let hasError = false;
  if (output.errors) {
    for (const err of output.errors) {
      if (err.severity === "error") {
        hasError = true;
        console.error(err.formattedMessage);
      } else {
        console.warn(err.formattedMessage);
      }
    }
  }
  if (hasError) {
    process.exit(1);
  }

  for (const [file, contractsInFile] of Object.entries(output.contracts)) {
    for (const [contractName, contractData] of Object.entries(contractsInFile)) {
      const outDir = path.join(ARTIFACTS_DIR, "contracts", file);
      fs.mkdirSync(outDir, { recursive: true });
      const artifact = {
        _format: "hh-sol-artifact-1",
        contractName,
        sourceName: file,
        abi: contractData.abi,
        bytecode: "0x" + contractData.evm.bytecode.object,
        deployedBytecode: "0x" + contractData.evm.deployedBytecode.object,
        linkReferences: {},
        deployedLinkReferences: {},
      };
      fs.writeFileSync(path.join(outDir, `${contractName}.json`), JSON.stringify(artifact, null, 2));
    }
  }

  console.log(`Compiled ${relFiles.length} source file(s) -> ${ARTIFACTS_DIR}`);
}

main();
