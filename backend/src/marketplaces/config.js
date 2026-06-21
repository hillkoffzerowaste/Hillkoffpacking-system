import { config as appConfig } from "../config.js";

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function enabled(...values) {
  return values.every(Boolean);
}

const callbackBase = appConfig.publicApiUrl.replace(/\/$/, "");
export const marketplaceFrontendUrl = env(
  "MARKETPLACE_FRONTEND_URL",
  "https://hillkoffzerowaste.github.io/Hillkoffpacking-system/"
);

export const marketplaceConfigs = {
  shopee: {
    channel: "shopee",
    partnerId: env("SHOPEE_PARTNER_ID"),
    partnerKey: env("SHOPEE_PARTNER_KEY"),
    baseUrl: env("SHOPEE_API_BASE_URL", "https://partner.shopeemobile.com"),
    authPath: env("SHOPEE_AUTH_PATH", "/api/v2/shop/auth_partner"),
    tokenPath: env("SHOPEE_TOKEN_PATH", "/api/v2/auth/token/get"),
    refreshPath: env("SHOPEE_REFRESH_PATH", "/api/v2/auth/access_token/get"),
    orderListPath: env("SHOPEE_ORDER_LIST_PATH", "/api/v2/order/get_order_list"),
    orderDetailPath: env("SHOPEE_ORDER_DETAIL_PATH", "/api/v2/order/get_order_detail"),
    callbackUrl: env("SHOPEE_CALLBACK_URL", `${callbackBase}/integrations/shopee/callback`),
    webhookSecret: env("SHOPEE_WEBHOOK_SECRET", env("SHOPEE_PARTNER_KEY"))
  },
  lazada: {
    channel: "lazada",
    appKey: env("LAZADA_APP_KEY"),
    appSecret: env("LAZADA_APP_SECRET"),
    apiBaseUrl: env("LAZADA_API_BASE_URL", "https://api.lazada.co.th/rest"),
    authBaseUrl: env("LAZADA_AUTH_BASE_URL", "https://auth.lazada.com/rest"),
    authorizeUrl: env("LAZADA_AUTHORIZE_URL", "https://auth.lazada.com/oauth/authorize"),
    tokenPath: env("LAZADA_TOKEN_PATH", "/auth/token/create"),
    refreshPath: env("LAZADA_REFRESH_PATH", "/auth/token/refresh"),
    ordersPath: env("LAZADA_ORDERS_PATH", "/orders/get"),
    orderItemsPath: env("LAZADA_ORDER_ITEMS_PATH", "/order/items/get"),
    callbackUrl: env("LAZADA_CALLBACK_URL", `${callbackBase}/integrations/lazada/callback`),
    webhookSecret: env("LAZADA_WEBHOOK_SECRET", env("LAZADA_APP_SECRET"))
  },
  tiktok: {
    channel: "tiktok",
    appKey: env("TIKTOK_SHOP_APP_KEY"),
    appSecret: env("TIKTOK_SHOP_APP_SECRET"),
    serviceId: env("TIKTOK_SHOP_SERVICE_ID"),
    baseUrl: env("TIKTOK_SHOP_API_BASE_URL", "https://open-api.tiktokglobalshop.com"),
    authUrl: env("TIKTOK_SHOP_AUTHORIZE_URL", "https://services.tiktokshop.com/open/authorize"),
    tokenPath: env("TIKTOK_SHOP_TOKEN_PATH", "/api/v2/token/get"),
    refreshPath: env("TIKTOK_SHOP_REFRESH_PATH", "/api/v2/token/refresh"),
    ordersPath: env("TIKTOK_SHOP_ORDERS_PATH", "/order/202309/orders/search"),
    orderDetailPath: env("TIKTOK_SHOP_ORDER_DETAIL_PATH", "/order/202309/orders"),
    callbackUrl: env("TIKTOK_SHOP_CALLBACK_URL", `${callbackBase}/integrations/tiktok/callback`),
    webhookSecret: env("TIKTOK_SHOP_WEBHOOK_SECRET", env("TIKTOK_SHOP_APP_SECRET"))
  }
};

export function marketplaceStatus() {
  return {
    shopee: {
      configured: enabled(marketplaceConfigs.shopee.partnerId, marketplaceConfigs.shopee.partnerKey),
      callback_url: marketplaceConfigs.shopee.callbackUrl
    },
    lazada: {
      configured: enabled(marketplaceConfigs.lazada.appKey, marketplaceConfigs.lazada.appSecret),
      callback_url: marketplaceConfigs.lazada.callbackUrl
    },
    tiktok: {
      configured: enabled(marketplaceConfigs.tiktok.appKey, marketplaceConfigs.tiktok.appSecret),
      callback_url: marketplaceConfigs.tiktok.callbackUrl
    }
  };
}

export function requireMarketplaceConfig(channel) {
  const selected = marketplaceConfigs[channel];
  if (!selected) throw new Error(`Unsupported marketplace channel: ${channel}`);
  if (!marketplaceStatus()[channel].configured) {
    throw new Error(`${channel} integration is not configured. Add its credentials to the backend environment.`);
  }
  return selected;
}
