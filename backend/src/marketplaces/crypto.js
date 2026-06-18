import crypto from "node:crypto";

export function hmacSha256Hex(secret, value) {
  return crypto.createHmac("sha256", String(secret)).update(String(value)).digest("hex");
}

export function hmacSha256Upper(secret, value) {
  return hmacSha256Hex(secret, value).toUpperCase();
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function encryptionKey(secret) {
  if (!secret) {
    throw new Error("INTEGRATION_TOKEN_ENCRYPTION_KEY is required for marketplace connections.");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(value, secret) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((item) => item.toString("base64url")).join(".");
}

export function decryptSecret(value, secret) {
  if (!value) return null;
  const [ivText, tagText, encryptedText] = String(value).split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Stored marketplace token is invalid.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function randomState() {
  return crypto.randomBytes(24).toString("base64url");
}
