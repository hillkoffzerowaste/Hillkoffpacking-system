import { hmacSha256Upper } from "./crypto.js";
import { formBody, marketplaceFetch } from "./http.js";

export function lazadaSign(appSecret, path, params) {
  const encoded = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}${value}`)
    .join("");
  return hmacSha256Upper(appSecret, `${path}${encoded}`);
}

function commonParams(config, accessToken = "") {
  return {
    app_key: config.appKey,
    timestamp: Date.now(),
    sign_method: "sha256",
    ...(accessToken ? { access_token: accessToken } : {})
  };
}

async function lazadaRequest(config, path, params = {}, { auth = false, method = "GET" } = {}) {
  const base = auth ? config.authBaseUrl : config.apiBaseUrl;
  const allParams = { ...commonParams(config, params.access_token), ...params };
  allParams.sign = lazadaSign(config.appSecret, path, allParams);
  const url = new URL(path, base);
  if (method === "GET") {
    Object.entries(allParams).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    return marketplaceFetch(url);
  }
  return marketplaceFetch(url, {
    method,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody(allParams)
  });
}

export function lazadaAuthorizationUrl(config, state) {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("force_auth", "true");
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("client_id", config.appKey);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export function exchangeLazadaCode(config, code) {
  return lazadaRequest(config, config.tokenPath, { code }, { auth: true, method: "POST" });
}

export function refreshLazadaToken(config, connection) {
  return lazadaRequest(config, config.refreshPath, {
    refresh_token: connection.refresh_token
  }, { auth: true, method: "POST" });
}

export function fetchLazadaOrders(config, connection, { from, to, offset = 0 }) {
  return lazadaRequest(config, config.ordersPath, {
    access_token: connection.access_token,
    created_after: new Date(from).toISOString(),
    created_before: new Date(to).toISOString(),
    limit: 100,
    offset,
    sort_by: "updated_at",
    sort_direction: "DESC"
  });
}

export function fetchLazadaOrderItems(config, connection, orderId) {
  return lazadaRequest(config, config.orderItemsPath, {
    access_token: connection.access_token,
    order_id: orderId
  });
}
