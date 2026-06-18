import { nanoid } from "nanoid";
import { config } from "../config.js";
import { db, nowIso } from "../db.js";
import { decryptSecret, encryptSecret } from "./crypto.js";

function isoAfter(seconds) {
  const value = Number(seconds || 0);
  return value > 0 ? new Date(Date.now() + value * 1000).toISOString() : null;
}

export function saveMarketplaceConnection(channel, token, fallbackShopId = "") {
  const shopId = String(
    token.shop_id
    || token.seller_id
    || token.open_id
    || token.merchant_id
    || fallbackShopId
  ).trim();
  if (!shopId) throw new Error(`${channel} token response did not include a shop or seller identifier.`);

  const now = nowIso();
  const existing = db.prepare(
    "select * from marketplace_connections where channel = ? and external_shop_id = ?"
  ).get(channel, shopId);
  const metadata = {
    account: token.account || null,
    seller_name: token.seller_name || token.shop_name || null,
    country: token.country || token.region || null,
    raw_identifiers: {
      shop_id: token.shop_id || null,
      seller_id: token.seller_id || null,
      open_id: token.open_id || null,
      merchant_id: token.merchant_id || null
    }
  };

  db.prepare(`
    insert into marketplace_connections
      (id, channel, external_shop_id, shop_name, region, access_token_encrypted,
       refresh_token_encrypted, access_token_expires_at, refresh_token_expires_at,
       metadata_json, active, created_at, updated_at)
    values
      (@id, @channel, @shopId, @shopName, @region, @accessToken, @refreshToken,
       @accessExpiresAt, @refreshExpiresAt, @metadata, 1, @createdAt, @updatedAt)
    on conflict(channel, external_shop_id) do update set
      shop_name = excluded.shop_name,
      region = excluded.region,
      access_token_encrypted = excluded.access_token_encrypted,
      refresh_token_encrypted = coalesce(excluded.refresh_token_encrypted, marketplace_connections.refresh_token_encrypted),
      access_token_expires_at = excluded.access_token_expires_at,
      refresh_token_expires_at = coalesce(excluded.refresh_token_expires_at, marketplace_connections.refresh_token_expires_at),
      metadata_json = excluded.metadata_json,
      active = 1,
      updated_at = excluded.updated_at
  `).run({
    id: existing?.id || nanoid(),
    channel,
    shopId,
    shopName: token.shop_name || token.seller_name || existing?.shop_name || null,
    region: token.country || token.region || existing?.region || null,
    accessToken: encryptSecret(token.access_token, config.integrationTokenKey),
    refreshToken: token.refresh_token
      ? encryptSecret(token.refresh_token, config.integrationTokenKey)
      : null,
    accessExpiresAt: isoAfter(token.expire_in || token.expires_in || token.access_token_expire_in),
    refreshExpiresAt: isoAfter(token.refresh_expires_in || token.refresh_token_expire_in),
    metadata: JSON.stringify(metadata),
    createdAt: existing?.created_at || now,
    updatedAt: now
  });

  return getMarketplaceConnection(channel, shopId);
}

function reveal(row) {
  if (!row) return null;
  return {
    ...row,
    access_token: decryptSecret(row.access_token_encrypted, config.integrationTokenKey),
    refresh_token: decryptSecret(row.refresh_token_encrypted, config.integrationTokenKey),
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {}
  };
}

export function getMarketplaceConnection(channel, shopId) {
  return reveal(db.prepare(`
    select * from marketplace_connections
    where channel = ? and external_shop_id = ? and active = 1
  `).get(channel, String(shopId)));
}

export function listMarketplaceConnections(channel) {
  const rows = channel
    ? db.prepare("select * from marketplace_connections where channel = ? order by updated_at desc").all(channel)
    : db.prepare("select * from marketplace_connections order by channel, updated_at desc").all();
  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    external_shop_id: row.external_shop_id,
    shop_name: row.shop_name,
    region: row.region,
    active: Boolean(row.active),
    access_token_expires_at: row.access_token_expires_at,
    refresh_token_expires_at: row.refresh_token_expires_at,
    updated_at: row.updated_at
  }));
}

export function disableMarketplaceConnection(channel, shopId) {
  return db.prepare(`
    update marketplace_connections set active = 0, updated_at = ?
    where channel = ? and external_shop_id = ?
  `).run(nowIso(), channel, String(shopId));
}
