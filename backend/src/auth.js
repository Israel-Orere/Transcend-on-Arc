const { verifyMessage } = require("viem");

const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000; // 5 minutes, to bound replay window

/// Business owners prove wallet ownership by signing a short message
/// (no gas, no transaction) instead of a password. This lets a business
/// edit its off-chain pitch/description without the platform ever custodying
/// a credential -- ownership IS the private key.
///
/// Expected body: { address, message, signature }
/// where message must be exactly `Update Transcend profile/application for ${address} at ${timestampMs}`
/// and timestampMs must be within MAX_SIGNATURE_AGE_MS of now.
async function requireWalletSignature(req, res, next) {
  const { address, message, signature } = req.body || {};
  if (!address || !message || !signature) {
    return res.status(400).json({ error: "address, message, and signature are required" });
  }

  const match = message.match(/^Update Transcend (?:profile|application) for (0x[a-fA-F0-9]{40}) at (\d+)$/);
  if (!match) {
    return res.status(400).json({ error: "Malformed signed message" });
  }
  const [, signedAddress, timestampStr] = match;
  if (signedAddress.toLowerCase() !== address.toLowerCase()) {
    return res.status(400).json({ error: "Signed message does not match address" });
  }
  if (signedAddress.toLowerCase() !== req.params.address.toLowerCase()) {
    return res.status(403).json({ error: "Signature does not authorize editing this business" });
  }
  const age = Date.now() - Number(timestampStr);
  if (age > MAX_SIGNATURE_AGE_MS || age < -MAX_SIGNATURE_AGE_MS) {
    return res.status(401).json({ error: "Signature expired or timestamp invalid; sign a fresh message" });
  }

  const valid = await verifyMessage({ address, message, signature });
  if (!valid) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  req.walletAddress = address.toLowerCase();
  next();
}

module.exports = { requireWalletSignature };
