
process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";

const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const request = require("supertest");

const Order = require("../src/models/Order");
const Product = require("../src/models/Product");

const {
  releaseExpiredReservations,
} = require("../src/services/paymentReservationService");

const paymentRoutes = require("../src/routes/paymentRoutes");

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

const uri =
  "mongodb://127.0.0.1:27017/your_divine_store_test?replicaSet=rs0";

const app = express();

app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json" })
);
app.use(express.json());
app.use("/api/payments", paymentRoutes);

let product;

function makeEvent() {
  return {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_race_test_123",
          order_id: "order_race_test_123",
          amount: 64700,
          currency: "INR",
          status: "captured",
        },
      },
    },
  };
}

async function sendCapturedWebhook() {
  const rawBody = JSON.stringify(makeEvent());

  const signature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  return request(app)
    .post("/api/payments/webhook")
    .set("Content-Type", "application/json")
    .set("x-razorpay-signature", signature)
    .send(rawBody);
}

beforeAll(async () => {
  await mongoose.connect(uri);
});

beforeEach(async () => {
  await Order.deleteMany({});
  await Product.deleteMany({});

  // Stock is already reduced from 10 to 8 because
  // the pending Razorpay order has reserved 2 units.
  product = await Product.create({
    name: "Payment Race Test Pendant",
    slug: "payment-race-test-pendant",
    description: "Automated integration test product",
    price: 299,
    originalPrice: 399,
    category: "Religious",
    image: "/images/test-pendant.png",
    images: ["/images/test-pendant.png"],
    stock: 8,
    isActive: true,
  });

  await Order.create({
    orderNumber: `YDS-RACE-${Date.now()}`,
    customer: {
      name: "Payment Race Test",
      phone: "9999999999",
      email: "",
    },
    shippingAddress: {
      address: "Test Address",
      city: "Test City",
      state: "Jharkhand",
      pincode: "825301",
      country: "India",
    },
    items: [
      {
        productId: product._id,
        name: product.name,
        image: product.image,
        price: 299,
        quantity: 2,
        subtotal: 598,
      },
    ],
    subtotal: 598,
    shippingCharge: 49,
    totalAmount: 647,
    paymentMethod: "Razorpay",
    paymentStatus: "Pending",
    razorpayOrderId: "order_race_test_123",
    status: "Placed",
    stockReserved: true,
    stockRestocked: false,
    reservationExpiresAt: new Date(Date.now() - 60_000),
  });
});

afterAll(async () => {
  await mongoose.disconnect();
});

test("captured payment and expired cleanup never double-restore stock", async () => {
  const [webhookResponse, cleanupResult] = await Promise.all([
    sendCapturedWebhook(),
    releaseExpiredReservations(),
  ]);

  expect(webhookResponse.status).toBe(200);

  const savedOrder = await Order.findOne({
    razorpayOrderId: "order_race_test_123",
  });

  const savedProduct = await Product.findById(product._id);

  expect(savedOrder).toBeTruthy();
  expect(savedProduct).toBeTruthy();

  if (savedOrder.paymentStatus === "Paid") {
    // Payment won the race.
    // Reserved stock must remain deducted.
    expect(savedOrder.status).toBe("Placed");
    expect(savedOrder.stockReserved).toBe(true);
    expect(savedOrder.stockRestocked).toBe(false);
    expect(savedOrder.razorpayPaymentId).toBe("pay_race_test_123");
    expect(savedProduct.stock).toBe(8);
    expect(cleanupResult).toBe(0);
  } else {
    // Cleanup won the race.
    // The captured payment must not mark this order Paid.
    expect(savedOrder.paymentStatus).toBe("Pending");
    expect(savedOrder.status).toBe("Cancelled");
    expect(savedOrder.stockReserved).toBe(false);
    expect(savedOrder.stockRestocked).toBe(true);
    expect(savedProduct.stock).toBe(10);
    expect(cleanupResult).toBe(1);
  }
});
