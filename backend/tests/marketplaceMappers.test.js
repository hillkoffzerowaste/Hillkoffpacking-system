import assert from "node:assert/strict";
import test from "node:test";
import {
  mapLazadaApiOrders,
  mapShopeeApiOrders,
  mapTikTokApiOrders
} from "../src/marketplaces/mappers.js";

test("normalizes Shopee API orders for the existing import pipeline", () => {
  const rows = mapShopeeApiOrders({
    response: {
      order_list: [{
        order_sn: "SHP-1",
        buyer_username: "Buyer",
        shipping_carrier: "SPX",
        package_list: [{ tracking_number: "TH-SHP-1" }],
        item_list: [{
          model_sku: "SKU-SHP",
          item_name: "Shopee product",
          model_quantity_purchased: 2
        }]
      }]
    }
  });
  assert.deepEqual(rows[0], {
    "Order ID": "SHP-1",
    "Tracking Number": "TH-SHP-1",
    "Customer Name": "Buyer",
    "Shipping Provider": "SPX",
    "Shipping Option": "SPX",
    "SKU Reference No.": "SKU-SHP",
    "Product Name": "Shopee product",
    Quantity: 2
  });
});

test("normalizes Lazada and TikTok API orders", () => {
  const lazada = mapLazadaApiOrders({
    data: { orders: [{ order_id: "LAZ-1", order_number: "LAZ-1" }] }
  }, new Map([["LAZ-1", {
    data: [{
      order_item_id: "ITEM-1",
      tracking_code: "LEX-1",
      sku: "SKU-LAZ",
      name: "Lazada product",
      quantity: 1
    }]
  }]]));
  assert.equal(lazada[0].sellerSku, "SKU-LAZ");
  assert.equal(lazada[0].trackingCode, "LEX-1");

  const tiktok = mapTikTokApiOrders({
    data: {
      orders: [{
        id: "TT-1",
        tracking_number: "TT-TRACK-1",
        line_items: [{ seller_sku: "SKU-TT", product_name: "TikTok product", quantity: 3 }]
      }]
    }
  });
  assert.equal(tiktok[0]["Seller SKU"], "SKU-TT");
  assert.equal(tiktok[0].Quantity, 3);
});
