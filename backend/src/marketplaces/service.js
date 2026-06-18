import { nanoid } from "nanoid";
import { db, nowIso } from "../db.js";
import { importRows } from "../importService.js";
import { randomState } from "./crypto.js";
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

function rememberState(channel) {
  const state = randomState();
  db.prepare(`
    insert into marketplace_oauth_states (state, channel, expires_at, created_at)
    values (?, ?, ?, ?)
  `).run(
    state,
    channel,
    new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    nowIso()
  );
  return state;
}

function verifyState(channel, state) {
  if (channel === "shopee" && !state) return;
  const saved = db.prepare("select * from marketplace_oauth_states where state = ?").get(String(state || ""));
  db.prepare("delete from marketplace_oauth_states where state = ?").run(String(state || ""));
  db.prepare("delete from marketplace_oauth_states where expires_at < ?").run(nowIso());
  if (!saved || saved.channel !== channel || Date.parse(saved.expires_at) < Date.now()) {
    throw new Error("Marketplace authorization state is invalid or expired.");
  }
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
  return saveMarketplaceConnection(channel, normalized, query.shop_id || query.seller_id);
}

function expiringSoon(connection) {
  if (!connection.access_token_expires_at) return false;
  return Date.parse(connection.access_token_expires_at) < Date.now() + 5 * 60 * 1000;
}

async function activeConnection(channel, shopId) {
  let connection = getMarketplaceConnection(channel, shopId);
  if (!connection) throw new Error(`No active ${channel} connection found for shop ${shopId}.`);
  if (!expiringSoon(connection) || !connection.refresh_token) return connection;

  const config = requireMarketplaceConfig(channel);
  let token;
  if (channel === "shopee") token = await refreshShopeeToken(config, connection);
  if (channel === "lazada") token = await refreshLazadaToken(config, connection);
  if (channel === "tiktok") token = await refreshTikTokToken(config, connection);
  connection = saveMarketplaceConnection(channel, token?.data || token?.response || token, shopId);
  return connection;
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
  const connection = await activeConnection(channel, shopId);
  const to = options.to || new Date().toISOString();
  const from = options.from || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let rows = [];
  if (channel === "shopee") rows = await shopeeRows(config, connection, { from, to });
  if (channel === "lazada") rows = await lazadaRows(config, connection, { from, to });
  if (channel === "tiktok") {
    rows = mapTikTokApiOrders(await fetchTikTokOrders(config, connection, { from, to }));
  }
  return importRows({
    rows,
    channel,
    deduplicationAction: options.deduplicationAction === "overwrite" ? "overwrite" : "ignore",
    fileName: `api-${channel}-${shopId}-${new Date().toISOString()}`,
    source: "api"
  });
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
