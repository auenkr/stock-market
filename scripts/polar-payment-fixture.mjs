import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";

// An owned, loopback-only substitute for Polar/Stripe's remote boundary.
// Auth, checkout creation, webhook verification, and access storage stay real.
export async function createPaymentGateway({ webhookUrl }) {
  if (!["127.0.0.1", "localhost"].includes(new URL(webhookUrl).hostname)) throw new Error("Payment fixtures require a loopback webhook");
  const token = "test-polar-token";
  const products = { basic: "66666666-6666-4666-8666-666666666666", personal: "11111111-1111-4111-8111-111111111111", professional: "22222222-2222-4222-8222-222222222222" };
  const customers = new Map();
  const checkouts = new Map();
  const orders = [];
  const deliveries = [];
  let url;
  const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  function state(customer) {
    return { ...customer, active_subscriptions: customer.subscription ? [customer.subscription] : [], granted_benefits: [], active_meters: [] };
  }
  function customer(externalId) {
    const found = customers.get(externalId);
    if (!found) throw new Error("Unknown fixture customer");
    return found;
  }
  async function replay(delivery) {
    // A retry keeps the event body/id but receives a fresh delivery signature.
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "billing-test-webhook-secret").update(`${delivery.id}.${timestamp}.${delivery.body}`).digest("base64");
    const response = await fetch(webhookUrl, { method: "POST", body: delivery.body, headers: {
      "content-type": "application/json", "webhook-id": delivery.id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}`,
    } });
    delivery.status = response.status;
    await response.text();
    return response.status;
  }
  async function emit(type, data) {
    const delivery = { id: randomUUID(), type, body: JSON.stringify({ type, timestamp: new Date().toISOString(), data }), status: 0 };
    deliveries.push(delivery);
    await replay(delivery);
    return delivery;
  }
  function subscriptionPayload(owner) { return { ...owner.subscription, customer: state(owner), customer_id: owner.id }; }
  function order(owner, checkout, paid, reason = "subscription_create") {
    const result = { id: randomUUID(), customer: state(owner), customer_id: owner.id, product_id: products[checkout.plan],
      subscription_id: owner.subscription?.id ?? null, checkout_id: checkout.id, amount: checkout.amount,
      currency: "inr", paid, status: paid ? "paid" : "pending", billing_reason: reason };
    orders.push(result);
    return result;
  }
  async function pay(checkoutId, card) {
    const checkout = checkouts.get(checkoutId);
    if (!checkout) throw new Error("Unknown checkout");
    if (checkout.status === "succeeded") return { paid: true, checkout, order: orders.find((entry) => entry.checkout_id === checkoutId && entry.paid) };
    const owner = customer(checkout.external_customer_id);
    if (card.replace(/\s/g, "") !== "4242424242424242") {
      const unpaid = order(owner, checkout, false);
      await emit("order.created", unpaid);
      await emit("checkout.updated", { ...checkout, status: "open" });
      return { paid: false, checkout, order: unpaid };
    }
    const now = new Date().toISOString();
    owner.subscription = { id: randomUUID(), created_at: now, modified_at: now, metadata: {}, status: "active",
      amount: checkout.amount, currency: "inr", recurring_interval: "month", current_period_start: now,
      current_period_end: new Date(Date.now() + 30 * 86400_000).toISOString(), trial_start: null, trial_end: null,
      cancel_at_period_end: false, canceled_at: null, started_at: now, ends_at: null, product_id: products[checkout.plan],
      discount_id: null, seats: null, units: null, meters: [] };
    checkout.status = "succeeded";
    const paid = order(owner, checkout, true);
    await emit("order.paid", paid);
    await emit("subscription.active", subscriptionPayload(owner));
    await emit("customer.state_changed", state(owner));
    return { paid: true, checkout, order: paid };
  }
  async function renew(externalId, paid) {
    const owner = customer(externalId);
    if (!owner.subscription) throw new Error("No subscription to renew");
    const checkout = [...checkouts.values()].find((entry) => entry.external_customer_id === externalId && entry.status === "succeeded");
    const invoice = order(owner, checkout, paid, "subscription_cycle");
    owner.subscription.status = paid ? "active" : "past_due";
    if (paid) owner.subscription.current_period_end = new Date(new Date(owner.subscription.current_period_end).getTime() + 30 * 86400_000).toISOString();
    await emit(paid ? "order.paid" : "order.updated", invoice);
    await emit(paid ? "subscription.cycled" : "subscription.past_due", subscriptionPayload(owner));
    await emit("customer.state_changed", state(owner));
    return invoice;
  }
  async function revoke(externalId) {
    const owner = customer(externalId);
    const payload = { ...subscriptionPayload(owner), status: "canceled", ended_at: new Date().toISOString() };
    owner.subscription = null;
    await emit("subscription.revoked", payload);
    await emit("customer.state_changed", state(owner));
  }
  const server = createServer(async (request, response) => {
    try {
      const target = new URL(request.url, url);
      const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString();
      const json = () => raw ? JSON.parse(raw) : {};
      const send = (status, body) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
      const hosted = target.pathname.match(/^\/checkout\/([^/]+)(\/pay)?$/);
      if (hosted) {
        const checkout = checkouts.get(hosted[1]);
        if (!checkout) return send(404, { error: "Unknown checkout" });
        if (hosted[2]) {
          const result = await pay(checkout.id, new URLSearchParams(raw).get("card") || "");
          response.writeHead(303, { location: result.paid ? checkout.success_url : `/checkout/${checkout.id}?error=declined` }); response.end(); return;
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Fixture payment checkout</title></head><body><main><h1>Ledgerline ${escape(checkout.plan)}</h1><p>₹${(checkout.amount / 100).toLocaleString("en-IN")} / month</p><p>Simulated Polar/Stripe test checkout</p>${target.searchParams.has("error") ? '<p role="alert">Your card was declined. Please try another card.</p>' : ""}<form method="post" action="/checkout/${checkout.id}/pay"><label>Card number<input name="card" required autocomplete="off"></label><label>Expiry<input name="expiry" required></label><label>CVC<input name="cvc" required></label><button type="submit">Subscribe now</button></form><a href="${escape(checkout.return_url)}">Back to billing</a></main></body></html>`); return;
      }
      if (request.headers.authorization !== `Bearer ${token}`) return send(401, { error: "Unauthorized fixture request" });
      if (target.pathname === "/__test/renew") { const body = json(); return send(200, await renew(body.externalId, body.paid)); }
      if (target.pathname === "/__test/revoke") { await revoke(json().externalId); return send(200, { ok: true }); }
      if (target.pathname === "/v1/customers/" && request.method === "POST") {
        const body = json(); const now = new Date().toISOString();
        const owner = { id: randomUUID(), external_id: body.external_id, email: body.email, name: body.name, type: "individual",
          created_at: now, modified_at: now, email_verified: true, metadata: body.metadata ?? {}, billing_name: null,
          billing_address: null, tax_id: null, deleted_at: null, first_user_event_at: null, avatar_url: null,
          organization_id: "44444444-4444-4444-8444-444444444444", subscription: null };
        customers.set(body.external_id, owner); return send(201, state(owner));
      }
      const external = target.pathname.match(/^\/v1\/customers\/external\/([^/]+)\/state$/);
      if (external) return customers.has(decodeURIComponent(external[1])) ? send(200, state(customer(decodeURIComponent(external[1])))) : send(404, { error: "ResourceNotFound", detail: "Missing customer" });
      if (target.pathname === "/v1/checkouts/" && request.method === "POST") {
        const body = json(); const plan = Object.keys(products).find((key) => products[key] === body.products?.[0]);
        if (!plan || body.products.length !== 1 || !customers.has(body.external_customer_id)) return send(422, { error: "Invalid checkout" });
        const id = randomUUID(); const checkout = { ...body, id, plan, amount: { basic: 19900, personal: 39900, professional: 249900 }[plan], currency: "inr", status: "open", url: `${url}/checkout/${id}` };
        checkouts.set(id, checkout); return send(201, checkout);
      }
      if (target.pathname === "/v1/customer-sessions/" && request.method === "POST") return send(201, { customer_portal_url: `${url}/portal` });
      return send(404, { error: "Unexpected payment fixture route", path: target.pathname });
    } catch (error) { response.writeHead(500, { "content-type": "application/json" }); response.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  return { url, pay, renew, revoke, emit, replay, deliveries, orders, checkouts,
    getState: (externalId) => state(customer(externalId)),
    close: () => new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); }),
  };
}
