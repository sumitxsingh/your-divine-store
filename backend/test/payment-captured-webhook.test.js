
const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const request = require("supertest");

jest.mock("../src/models/Order", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

jest.mock("../src/models/Product", () => ({
  updateOne: jest.fn(),
}));

jest.mock("../src/config/razorpay", () => ({
  getRazorpayClient: jest.fn(),
}));

const Order = require("../src/models/Order");
const paymentRoutes = require("../src/routes/paymentRoutes");

const WEBHOOK_SECRET = "test_webhook_secret";

process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

const app = express();

app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json" })
);
app.use(express.json());
app.use("/api/payments", paymentRoutes);

function signPayload(rawBody) {
  return crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
}

async function sendWebhook(event, signatureOverride) {
  const rawBody = JSON.stringify(event);
  const signature = signatureOverride || signPayload(rawBody);

  return request(app)
    .post("/api/payments/webhook")
    .set("Content-Type", "application/json")
    .set("x-razorpay-signature", signature)
    .send(rawBody);
}

function makePayment(overrides = {}) {
  return {
    id: "pay_test_123",
    order_id: "order_test_123",
    amount: 64700,
    currency: "INR",
    status: "captured",
    ...overrides,
  };
}

function makeEvent(payment) {
  return {
    event: "payment.captured",
    payload: {
      payment: {
        entity: payment,
      },
    },
  };
}

function makeOrder(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    orderNumber: "YDS-TEST-001",
    razorpayOrderId: "order_test_123",
    razorpayPaymentId: null,
    paymentMethod: "Razorpay",
    paymentStatus: "Pending",
    status: "Placed",
    totalAmount: 647,
    stockReserved: true,
    stockRestocked: false,
    reservationExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    ...overrides,
  };
}

describe("Razorpay payment.captured webhook", () => {
  let session;
  let order;

  beforeEach(() => {
    jest.clearAllMocks();

    order = makeOrder();

    session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };

    jest.spyOn(mongoose, "startSession").mockResolvedValue(session);

    Order.findOne.mockResolvedValue(order);
    Order.findOneAndUpdate.mockResolvedValue({
      ...order,
      paymentStatus: "Paid",
      razorpayPaymentId: "pay_test_123",
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("marks a valid captured payment as Paid", async () => {
    const response = await sendWebhook(makeEvent(makePayment()));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Payment processed.");

    expect(Order.findOne).toHaveBeenCalledWith({
      razorpayOrderId: "order_test_123",
      paymentMethod: "Razorpay",
    });

    expect(Order.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: order._id,
        razorpayOrderId: "order_test_123",
        paymentMethod: "Razorpay",
        paymentStatus: "Pending",
        status: "Placed",
        stockReserved: true,
        stockRestocked: false,
        reservationExpiresAt: expect.any(Object),
      }),
      {
        $set: {
          paymentStatus: "Paid",
          razorpayPaymentId: "pay_test_123",
        },
      },
      {
        new: true,
        session,
      }
    );

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  test("acknowledges a duplicate captured payment safely", async () => {
    order.paymentStatus = "Paid";
    order.razorpayPaymentId = "pay_test_123";

    const response = await sendWebhook(makeEvent(makePayment()));

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Payment already processed.");

    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
    expect(mongoose.startSession).not.toHaveBeenCalled();
  });

  test("does not mark an order Paid when payment amount mismatches", async () => {
    const response = await sendWebhook(
      makeEvent(makePayment({ amount: 50000 }))
    );

    expect(response.status).toBe(200);
    expect(response.body.message).toBe(
      "Payment acknowledged for reconciliation."
    );

    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
    expect(mongoose.startSession).not.toHaveBeenCalled();
  });

  test("acknowledges payment when no matching order exists", async () => {
    Order.findOne.mockResolvedValue(null);

    const response = await sendWebhook(makeEvent(makePayment()));

    expect(response.status).toBe(200);
    expect(response.body.message).toBe(
      "Payment acknowledged for reconciliation."
    );

    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("does not mark an expired reservation as Paid", async () => {
    Order.findOneAndUpdate.mockResolvedValue(null);

    const response = await sendWebhook(makeEvent(makePayment()));

    expect(response.status).toBe(200);
    expect(response.body.message).toBe(
      "Payment acknowledged for reconciliation."
    );

    expect(Order.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

test("rejects an invalid webhook signature", async () => {
  const response = await sendWebhook(
    makeEvent(makePayment()),
    "a".repeat(64)
  );

  expect(response.status).toBe(401);
  expect(response.body.success).toBe(false);

  expect(Order.findOne).not.toHaveBeenCalled();
  expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
});

  test("rejects a payment that is not captured", async () => {
    const response = await sendWebhook(
      makeEvent(makePayment({ status: "authorized" }))
    );

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);

    expect(Order.findOne).not.toHaveBeenCalled();
    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("does not overwrite an already Paid order with a different payment", async () => {
    order.paymentStatus = "Paid";
    order.razorpayPaymentId = "pay_original_123";

    const response = await sendWebhook(makeEvent(makePayment()));

    expect(response.status).toBe(200);
    expect(response.body.message).toBe(
      "Payment acknowledged for reconciliation."
    );

    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
    expect(mongoose.startSession).not.toHaveBeenCalled();
  });
});
