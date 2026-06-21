import { nanoid } from "nanoid";
import { db, nowIso } from "../db.js";
import { importRows } from "../importService.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { requireMarketplaceConfig } from "./config.js";
import {
  exchangeLazadaCode,
  fetchLazadaOrderItems,
  fetchLazadaOrders,
  lazadaAuthorizationUrl,
  refreshLazadaToken
} from "./lazada.js";
import { mapLazadaApiOrders, mapShopeeApiOrders, mapTikTokApiOrders } from "./mappers.js";
import {
  exchangeShopeeCode,
  fetchShopeeOrderDetails,
  fetchShopeeOrders,
  refreshShopeeToken,
  shopeeAuthorizationUrl
} from "./shopee.js";
import { exchangeTikTokCode, fetchTikTokOrders, refreshTikTokToken, tiktokAuthorizationUrl } from "./tiktok.js";
import {
  getMarketplaceConnection,
  saveMarketplaceConnection
} from "./tokenStore.js";

function ticketSecret() {
  return process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || "";
}

function rememberState(channel) {
  return encryptSecret(JSON.stringify({
    channel,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  }), ticketSecret());
}

function verifyState(channel, state) {
  if (channel === "shopee" && !state) return;
  let saved;
  try {
    saved = JSON.parse(decryptSecret(String(state || ""), ticketSecret()));
  } catch {
    saved = null;
  }
  if (!saved || saved.channel !== channel || Date.parse(saved.expires_at) < Date.now()) {
    throw new Error("Marketplace authorization state is invalid or expired.");
  }
}

function tokenConnection(channel, token, fallbackShopId = "") {
  const shopId = String(
    token.shop_id
    || token.seller_id
    || token.open_id
    || token.merchant_id
    || fallbackShopId
  ).trim();
  if (!shopId) throw new Error(`${channel} token response did not include a shop or seller identifier.`);
  const accessSeconds = Number(token.expire_in || token.expires_in || token.access_token_expire_in || 0);
  const refreshSeconds = Number(token.refresh_expires_in || token.refresh_token_expire_in || 0);
  return {
    channel,
    external_shop_id: shopId,
    shop_name: token.shop_name || token.seller_name || null,
    region: token.country || token.region || null,
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    access_token_expires_at: accessSeconds
      ? new Date(Date.now() + accessSeconds * 1000).toISOString()
      : null,
    refresh_token_expires_at: refreshSeconds
      ? new Date(Date.now() + refreshSeconds * 1000).toISOString()
      : null,
    metadata: {
      shop_cipher: token.shop_cipher || token.cipher || token.shop_id || fallbackShopId,
      seller_name: token.seller_name || token.shop_name || null
    }
  };
}

function createConnectionTicket(connection) {
  return encryptSecret(JSON.stringify(connection), ticketSecret());
}

function readConnectionTicket(channel, ticket) {
  if (!ticket) return null;
  let connection;
  try {
    connection = JSON.parse(decryptSecret(ticket, ticketSecret()));
  } catch {
    throw new Error("Marketplace connection ticket is invalid. Please connect the shop again.");
  }
  if (connection.channel !== channel) {
    throw new Error("Marketplace connection ticket does not match this channel.");
  }
  return connection;
}

export function createAuthorizationUrl(channel) {
  const config = requireMarketplaceConfig(channel);
  const state = rememberState(channel);
  if (channel === "shopee") return shopeeAuthorizationUrl(config);
  if (channel === "lazada") return lazadaAuthorizationUrl(config, state);
  if (channel === "tiktok") return tiktokAuthorizationUrl(config, state);
  throw new Error(`Unsupported marketplace channel: ${channel}`);
}

export async function completeAuthorization(channel, query) {
  const config = requireMarketplaceConfig(channel);
  verifyState(channel, query.state);
  const code = query.code || query.auth_code;
  if (!code) throw new Error("Marketplace callback did not include an authorization code.");

  let token;
  if (channel === "shopee") token = await exchangeShopeeCode(config, code, query.shop_id);
  if (channel === "lazada") token = await exchangeLazadaCode(config, code);
  if (channel === "tiktok") token = await exchangeTikTokCode(config, code);
  const normalized = token?.data || token?.response || token;
  const connection = tokenConnection(channel, normalized, query.shop_id || query.seller_id);
  try {
    saveMarketplaceConnection(channel, normalized, query.shop_id || query.seller_id);
  } catch (error) {
    console.warn("Persistent marketplace connection storage is unavailable; using encrypted browser ticket.", error.message);
  }
  return { connection, connection_ticket: createConnectionTicket(connection) };
}

function expiringSoon(connection) {
  if (!connection.access_token_expires_at) return false;
  return Date.parse(connection.access_token_expires_at) < Date.now() + 5 * 60 * 1000;
}

async function activeConnection(channel, shopId, connectionTicket = "") {
  let connection = readConnectionTicket(channel, connectionTicket)
    || getMarketplaceConnection(channel, shopId);
  if (!connection) throw new Error(`No active ${channel} connection found for shop ${shopId}.`);
  if (!expiringSoon(connection) || !connection.refresh_token) {
    return { connection, connection_ticket: createConnectionTicket(connection) };
  }

  const config = requireMarketplaceConfig(channel);
  let token;
  if (channel === "shopee") token = await refreshShopeeToken(config, connection);
  if (channel === "lazada") token = await refreshLazadaToken(config, connection);
  if (channel === "tiktok") token = await refreshTikTokToken(config, connection);
  const normalized = token?.data || token?.response || token;
  connection = tokenConnection(channel, normalized, shopId);
  try {
    saveMarketplaceConnection(channel, normalized, shopId);
  } catch (error) {
    console.warn("Refreshed marketplace token could not be persisted; continuing with encrypted browser ticket.", error.message);
  }
  return { connection, connection_ticket: createConnectionTicket(connection) };
}

async function shopeeRows(config, connection, range) {
  const list = await fetchShopeeOrders(config, connection, range);
  const orderSns = (list?.response?.order_list || list?.order_list || []).map((order) => order.order_sn).filter(Boolean);
  if (!orderSns.length) return [];
  const details = await fetchShopeeOrderDetails(config, connection, orderSns);
  return mapShopeeApiOrders(details);
}

async function lazadaRows(config, connection, range) {
  const orders = await fetchLazadaOrders(config, connection, range);
  const orderList = orders?.data?.orders || orders?.orders || [];
  const itemPayloads = new Map();
  await Promise.all(orderList.map(async (order) => {
    const orderId = String(order.order_id || order.order_number);
    itemPayloads.set(orderId, await fetchLazadaOrderItems(config, connection, orderId));
  }));
  return mapLazadaApiOrders(orders, itemPayloads);
}

export async function syncMarketplaceOrders(channel, shopId, options = {}) {
  const config = requireMarketplaceConfig(channel);
  const active = await activeConnection(channel, shopId, options.connectionTicket);
  const connection = active.connection;
  const to = options.to || new Date().toISOString();
  const from = options.from || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let rows = [];
  if (channel === "shopee") rows = await shopeeRows(config, connection, { from, to });
  if (channel === "lazada") rows = await lazadaRows(config, connection, { from, to });
  if (channel === "tiktok") {
    rows = mapTikTokApiOrders(await fetchTikTokOrders(config, connection, { from, to }));
  }
  if (options.previewOnly) {
    return {
      channel,
      shop_id: connection.external_shop_id,
      fetched_count: rows.length,
      rows,
      connection_ticket: active.connection_ticket
    };
  }
  return {
    ...importRows({
    rows,
    channel,
    deduplicationAction: options.deduplicationAction === "overwrite" ? "overwrite" : "ignore",
    fileName: `api-${channel}-${shopId}-${new Date().toISOString()}`,
    source: "api"
    }),
    fetched_count: rows.length,
    connection_ticket: active.connection_ticket
  };
}

export function recordWebhook(channel, payload) {
  const eventId = String(
    payload.event_id
    || payload.data?.event_id
    || payload.msg_id
    || payload.id
    || ""
  );
  const eventType = String(payload.event || payload.type || payload.data?.type || "");
  const id = nanoid();
  try {
    db.prepare(`
      insert into marketplace_webhook_events
        (id, channel, external_event_id, event_type, payload_json, status, received_at)
      values
        (?, ?, ?, ?, ?, 'received', ?)
    `).run(id, channel, eventId || null, eventType || null, JSON.stringify(payload), nowIso());
  } catch (error) {
    if (!String(error.message).includes("UNIQUE")) throw error;
    return { accepted: true, duplicate: true, event_id: eventId };
  }
  return { accepted: true, duplicate: false, event_id: eventId || id };
}
