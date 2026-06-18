const MARKETPLACE_API_BASE = (
  import.meta.env.VITE_MARKETPLACE_API_BASE
  || import.meta.env.VITE_API_BASE
  || "http://localhost:4000/api"
).replace(/\/$/, "");

async function request(path, options = {}) {
  const response = await fetch(`${MARKETPLACE_API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.code || "Marketplace request failed.");
  return data;
}

export function getMarketplaceIntegrationStatus() {
  return request("/integrations/status");
}

export async function openMarketplaceAuthorization(channel) {
  const data = await request(`/integrations/${encodeURIComponent(channel)}/authorize`);
  if (!data.authorization_url) throw new Error("Marketplace authorization URL is missing.");
  window.location.assign(data.authorization_url);
}

export function syncMarketplaceOrders(channel, payload) {
  return request(`/integrations/${encodeURIComponent(channel)}/sync`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function disconnectMarketplace(channel, shopId) {
  return request(
    `/integrations/${encodeURIComponent(channel)}/connections/${encodeURIComponent(shopId)}`,
    { method: "DELETE" }
  );
}
