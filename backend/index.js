require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const { startIndexer } = require("./src/indexer");
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

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/config", (req, res) => {
  const addresses = loadDeploymentAddresses();
  res.json({
    chainId: chain.id,
    rpcUrl: chain.rpcUrls.default.http[0],
    ...addresses,
  });
});

app.use("/businesses", businessesRouter);
app.use("/deals", dealsRouter);
app.use("/verifiers", verifiersRouter);
app.use("/profiles", profileRouter);
app.use("/investors", investorsRouter);
app.use("/applications", applicationsRouter);
app.use("/market", marketRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Transcend backend listening on :${PORT}`);
  startIndexer();
});
