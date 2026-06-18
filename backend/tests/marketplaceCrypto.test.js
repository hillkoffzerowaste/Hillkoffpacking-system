import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptSecret,
  encryptSecret,
  hmacSha256Hex,
  timingSafeEqualText
} from "../src/marketplaces/crypto.js";
import { lazadaSign } from "../src/marketplaces/lazada.js";
import { shopeeSign } from "../src/marketplaces/shopee.js";
import { tiktokShopSign } from "../src/marketplaces/tiktok.js";

test("encrypts and decrypts marketplace tokens", () => {
  const encrypted = encryptSecret("access-token", "test-encryption-key");
  assert.notEqual(encrypted, "access-token");
  assert.equal(decryptSecret(encrypted, "test-encryption-key"), "access-token");
});

test("creates stable marketplace request signatures", () => {
  const shopee = shopeeSign(
    { partnerId: "1001", partnerKey: "secret" },
    "/api/v2/order/get_order_list",
    1700000000,
    "token",
    "2002"
  );
  assert.equal(shopee, hmacSha256Hex(
    "secret",
    "1001/api/v2/order/get_order_list1700000000token2002"
  ));

  const lazada = lazadaSign("secret", "/orders/get", {
    app_key: "1001",
    timestamp: 1700000000000
  });
  assert.match(lazada, /^[A-F0-9]{64}$/);

  const tiktok = tiktokShopSign("secret", "/order/202309/orders/search", {
    app_key: "1001",
    timestamp: 1700000000
  }, "{}");
  assert.match(tiktok, /^[a-f0-9]{64}$/);
  assert.equal(timingSafeEqualText(tiktok, tiktok), true);
});
