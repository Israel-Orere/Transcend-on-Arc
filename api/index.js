const app = require("../backend/index");

// Keep the browser API at /api/* while the Express application remains usable
// directly at :4000 for local development.
module.exports = (req, res) => {
  req.url = req.url.replace(/^\/api(?=\/|$)/, "") || "/";
  return app(req, res);
};
