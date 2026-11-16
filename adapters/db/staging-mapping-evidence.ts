import { readFile } from "node:fs/promises";
import { createWooPurchaseReader } from "../../../fretwise-lms-frontend/lib/server/woocommerce-reader.js";
const url = new URL(process.env.DATABASE_URL ?? "");
if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms") {throw new Error("Local staging database required.");}
const credentials = JSON.parse(await readFile("tmp/staging-sync/credentials.json", "utf8"));
const read = createWooPurchaseReader({ origin: "https://getfretwise-cydd.1wp.site", allowedOrigins: ["https://getfretwise-cydd.1wp.site"], credentials });
for (const customer of [23003227, 23003228]) {
  const result = await read(customer);
  const orders = result.orders.filter((order) => order.line_items.some((item) => [22049175, 22049189].includes(item.product_id)));
  process.stdout.write(JSON.stringify({ customer, orders: orders.map((order) => ({ id: order.id, status: order.status, paid: !!order.date_paid_gmt, products: order.line_items.map((item) => item.product_id).filter((id) => [22049175, 22049189].includes(id)) })), subscriptionStatuses: result.subscriptions.filter((item) => item.line_items.some((line) => line.product_id === 22049176)).map((item) => item.status) }) + "\n");
}
