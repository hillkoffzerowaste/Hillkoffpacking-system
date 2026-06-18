import express from "express";
import { marketplaceStatus, requireMarketplaceConfig } from "./config.js";
import {
  completeAuthorization,
  createAuthorizationUrl,
  recordWebhook,
  syncMarketplaceOrders
} from "./service.js";
import {
  disableMarketplaceConnection,
  listMarketplaceConnections
} from "./tokenStore.js";
import { verifyMarketplaceWebhook } from "./webhooks.js";

export const marketplaceRouter = express.Router();
const channels = new Set(["shopee", "lazada", "tiktok"]);

function channelParam(req) {
  const channel = String(req.params.channel || "").toLowerCase();
  if (!channels.has(channel)) throw new Error(`Unsupported marketplace channel: ${channel}`);
  return channel;
}

marketplaceRouter.get("/status", (_req, res) => {
  res.json({ platforms: marketplaceStatus(), connections: listMarketplaceConnections() });
});

marketplaceRouter.get("/:channel/authorize", (req, res) => {
  res.json({ authorization_url: createAuthorizationUrl(channelParam(req)) });
});

marketplaceRouter.get("/:channel/callback", async (req, res, next) => {
  try {
    const channel = channelParam(req);
    const connection = await completeAuthorization(channel, req.query);
    res.json({
      connected: true,
      channel,
      external_shop_id: connection.external_shop_id,
      shop_name: connection.shop_name
    });
  } catch (error) {
    next(error);
  }
});

marketplaceRouter.post("/:channel/sync", async (req, res, next) => {
  try {
    const channel = channelParam(req);
    const result = await syncMarketplaceOrders(channel, req.body.shop_id, {
      from: req.body.from,
      to: req.body.to,
      deduplicationAction: req.body.deduplication_action
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

marketplaceRouter.delete("/:channel/connections/:shopId", (req, res) => {
  const result = disableMarketplaceConnection(channelParam(req), req.params.shopId);
  res.json({ disconnected: result.changes > 0 });
});

marketplaceRouter.post("/:channel/webhook", (req, res, next) => {
  try {
    const channel = channelParam(req);
    verifyMarketplaceWebhook(channel, requireMarketplaceConfig(channel), req);
    res.json(recordWebhook(channel, req.body || {}));
  } catch (error) {
    error.status = 401;
    next(error);
  }
});
