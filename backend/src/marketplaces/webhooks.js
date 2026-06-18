import { hmacSha256Hex, timingSafeEqualText } from "./crypto.js";

function header(req, names) {
  for (const name of names) {
    const value = req.get(name);
    if (value) return value.replace(/^sha256=/i, "");
  }
  return "";
}

export function verifyMarketplaceWebhook(channel, config, req) {
  const signatureHeaders = {
    shopee: ["authorization", "x-shopee-signature"],
    lazada: ["authorization", "x-lazada-signature"],
    tiktok: ["authorization", "x-tts-signature", "x-tiktok-signature"]
  };
  const received = header(req, signatureHeaders[channel] || []);
  if (!config.webhookSecret) throw new Error(`${channel} webhook secret is not configured.`);
  if (!received) throw new Error(`${channel} webhook signature is missing.`);
  const expected = hmacSha256Hex(config.webhookSecret, req.rawBody || Buffer.from(JSON.stringify(req.body || {})));
  if (!timingSafeEqualText(received.toLowerCase(), expected.toLowerCase())) {
    throw new Error(`${channel} webhook signature is invalid.`);
  }
  return true;
}
