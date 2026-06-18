import { hmacSha256Hex } from "./crypto.js";
import { marketplaceFetch } from "./http.js";

export function tiktokShopSign(appSecret, path, params, body = "") {
  const encoded = Object.entries(params)
    .filter(([key, value]) => !["sign", "access_token"].includes(key) && value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}${value}`)
    .join("");
  return hmacSha256Hex(appSecret, `${appSecret}${path}${encoded}${body}${appSecret}`);
}

function signedRequest(config, connection, path, { method = "GET", params = {}, body = null } = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const common = {
    app_key: config.appKey,
    timestamp,
    shop_cipher: connection?.metadata?.shop_cipher || connection?.external_shop_id,
    ...params
  };
  const bodyText = body ? JSON.stringify(body) : "";
  common.sign = tiktokShopSign(config.appSecret, path, common, bodyText);
  const url = new URL(path, config.baseUrl);
  Object.entries(common).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return marketplaceFetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(connection?.access_token ? { "x-tts-access-token": connection.access_token } : {})
    },
    ...(bodyText ? { body: bodyText } : {})
  });
}

export function tiktokAuthorizationUrl(config, state) {
  const url = new URL(config.authUrl);
  url.searchParams.set("app_key", config.appKey);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  if (config.serviceId) url.searchParams.set("service_id", config.serviceId);
  return url.toString();
}

export function exchangeTikTokCode(config, code) {
  return signedRequest(config, null, config.tokenPath, {
    method: "POST",
    body: {
      app_key: config.appKey,
      app_secret: config.appSecret,
      auth_code: code,
      grant_type: "authorized_code"
    }
  });
}

export function refreshTikTokToken(config, connection) {
  return signedRequest(config, null, config.refreshPath, {
    method: "POST",
    body: {
      app_key: config.appKey,
      app_secret: config.appSecret,
      refresh_token: connection.refresh_token,
      grant_type: "refresh_token"
    }
  });
}

export function fetchTikTokOrders(config, connection, { from, to, pageToken = "" }) {
  return signedRequest(config, connection, config.ordersPath, {
    method: "POST",
    params: { page_size: 100, page_token: pageToken },
    body: {
      update_time_ge: Math.floor(new Date(from).getTime() / 1000),
      update_time_lt: Math.floor(new Date(to).getTime() / 1000),
      sort_order: "DESC"
    }
  });
}
