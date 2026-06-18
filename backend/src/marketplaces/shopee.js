import { hmacSha256Hex } from "./crypto.js";
import { marketplaceFetch } from "./http.js";

function timestamp() {
  return Math.floor(Date.now() / 1000);
}

export function shopeeSign(config, path, time, accessToken = "", shopId = "") {
  return hmacSha256Hex(config.partnerKey, `${config.partnerId}${path}${time}${accessToken}${shopId}`);
}

function signedUrl(config, path, { accessToken = "", shopId = "", params = {} } = {}) {
  const time = timestamp();
  const url = new URL(path, config.baseUrl);
  url.searchParams.set("partner_id", config.partnerId);
  url.searchParams.set("timestamp", String(time));
  url.searchParams.set("sign", shopeeSign(config, path, time, accessToken, shopId));
  if (accessToken) url.searchParams.set("access_token", accessToken);
  if (shopId) url.searchParams.set("shop_id", shopId);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url;
}

export function shopeeAuthorizationUrl(config) {
  const url = signedUrl(config, config.authPath);
  url.searchParams.set("redirect", config.callbackUrl);
  return url.toString();
}

export async function exchangeShopeeCode(config, code, shopId) {
  const url = signedUrl(config, config.tokenPath);
  return marketplaceFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      shop_id: Number(shopId),
      partner_id: Number(config.partnerId)
    })
  });
}

export async function refreshShopeeToken(config, connection) {
  const url = signedUrl(config, config.refreshPath);
  return marketplaceFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: connection.refresh_token,
      shop_id: Number(connection.external_shop_id),
      partner_id: Number(config.partnerId)
    })
  });
}

export async function fetchShopeeOrders(config, connection, { from, to, cursor = "" }) {
  const params = {
    time_range_field: "update_time",
    time_from: Math.floor(new Date(from).getTime() / 1000),
    time_to: Math.floor(new Date(to).getTime() / 1000),
    page_size: 100,
    cursor,
    response_optional_fields: "order_status"
  };
  return marketplaceFetch(signedUrl(config, config.orderListPath, {
    accessToken: connection.access_token,
    shopId: connection.external_shop_id,
    params
  }));
}

export async function fetchShopeeOrderDetails(config, connection, orderSnList) {
  return marketplaceFetch(signedUrl(config, config.orderDetailPath, {
    accessToken: connection.access_token,
    shopId: connection.external_shop_id,
    params: {
      order_sn_list: orderSnList.join(","),
      response_optional_fields: "buyer_user_id,buyer_username,recipient_address,item_list,shipping_carrier,package_list"
    }
  }));
}
