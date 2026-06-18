function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function number(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function mapShopeeApiOrders(payload) {
  const orders = payload?.response?.order_list || payload?.order_list || [];
  return orders.flatMap((order) => {
    const items = order.item_list || [];
    return items.map((item) => ({
      "Order ID": text(order.order_sn),
      "Tracking Number": text(order.package_list?.[0]?.logistics_status === "LOGISTICS_READY"
        ? order.package_list?.[0]?.tracking_number
        : order.tracking_number || order.package_list?.[0]?.tracking_number || order.order_sn),
      "Customer Name": text(order.recipient_address?.name || order.buyer_username),
      "Shipping Provider": text(order.shipping_carrier),
      "Shipping Option": text(order.package_list?.[0]?.shipping_carrier || order.shipping_carrier),
      "SKU Reference No.": text(item.model_sku || item.item_sku),
      "Product Name": text(item.item_name || item.model_name),
      Quantity: number(item.model_quantity_purchased || item.quantity)
    }));
  });
}

export function mapLazadaApiOrders(ordersPayload, itemPayloads = new Map()) {
  const orders = ordersPayload?.data?.orders || ordersPayload?.orders || [];
  return orders.flatMap((order) => {
    const itemsPayload = itemPayloads.get(String(order.order_id));
    const items = itemsPayload?.data || itemsPayload?.items || order.items || [];
    return items.map((item) => ({
      orderNumber: text(order.order_number || order.order_id),
      orderItemId: text(item.order_item_id),
      trackingCode: text(item.tracking_code || order.tracking_code || order.order_number),
      customerName: text(order.address_shipping?.first_name || order.customer_first_name),
      shippingProvider: text(item.shipment_provider || order.shipping_provider),
      deliveryType: text(item.shipping_type || order.delivery_type),
      sellerSku: text(item.sku || item.seller_sku),
      itemName: text(item.name || item.product_name),
      quantity: number(item.quantity)
    }));
  });
}

export function mapTikTokApiOrders(payload) {
  const orders = payload?.data?.orders || payload?.orders || [];
  return orders.flatMap((order) => {
    const lineItems = order.line_items || order.item_list || [];
    return lineItems.map((item) => ({
      "Order ID": text(order.id || order.order_id),
      "Tracking ID": text(order.tracking_number || order.packages?.[0]?.tracking_number || order.id),
      Recipient: text(order.recipient_address?.name || order.buyer_email),
      "Shipping Provider": text(order.shipping_provider || order.delivery_option_name),
      "Delivery Option": text(order.delivery_option_name || order.fulfillment_type),
      "Seller SKU": text(item.seller_sku || item.sku_id),
      "Product Name": text(item.product_name || item.display_status),
      Quantity: number(item.quantity)
    }));
  });
}
