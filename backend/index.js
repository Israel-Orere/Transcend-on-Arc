require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const { loadDeploymentAddresses, chain } = require("./src/chain");
const businessesRouter = require("./src/routes/businesses");
const dealsRouter = require("./src/routes/deals");
const verifiersRouter = require("./src/routes/verifiers");
const profileRouter = require("./src/routes/profile");
const investorsRouter = require("./src/routes/investors");
const applicationsRouter = require("./src/routes/applications");
const marketRouter = require("./src/routes/market");

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.get("/health", (req, res) => res.json({ ok: true, chainId: chain.id }));

app.get("/config", (req, res) => {
  const addresses = loadDeploymentAddresses({ required: false });
  res.json({
    chainId: chain.id,
    rpcUrl: chain.rpcUrls.default.http[0],
    explorerUrl: chain.id === 5042002 ? "https://testnet.arcscan.app" : null,
    deploymentReady: Boolean(addresses.businessRegistry && addresses.investmentPool),
    ...addresses,
  });
});

// A Vercel Function has no always-on process. Refresh the chain-derived cache
// before reads, throttled per warm instance. Local development retains the
// continuously polling indexer below.
let lastHostedSync = 0;
let hostedSync = null;
if (process.env.VERCEL) {
  app.use(async (req, res, next) => {
    const addresses = loadDeploymentAddresses({ required: false });
    if (!addresses.businessRegistry || !addresses.investmentPool) {
      return res.status(503).json({
        error: "Arc contracts are not deployed yet.",
        code: "ARC_DEPLOYMENT_PENDING",
      });
    }
    try {
      if (Date.now() - lastHostedSync > 5000) {
        hostedSync ||= require("./src/indexer").pollOnce().finally(() => { hostedSync = null; });
        await hostedSync;
        lastHostedSync = Date.now();
      }
      next();
    } catch (error) {
      next(error);
    }
  });
}

app.use("/businesses", businessesRouter);
app.use("/deals", dealsRouter);
app.use("/verifiers", verifiersRouter);
app.use("/profiles", profileRouter);
app.use("/investors", investorsRouter);
app.use("/applications", applicationsRouter);
app.use("/market", marketRouter);

if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`Transcend backend listening on :${PORT}`);
    require("./src/indexer").startIndexer();
  });
}

module.exports = app;
