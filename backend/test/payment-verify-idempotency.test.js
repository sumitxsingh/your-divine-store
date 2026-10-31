
const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const request = require("supertest");

jest.mock("../src/models/Order", () => ({
  findById: jest.fn(),
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
const { getRazorpayClient } = require("../src/config/razorpay");
const paymentRoutes = require("../src/routes/paymentRoutes");

const SECRET = "test_razorpay_secret";

process.env.RAZORPAY_KEY_SECRET = SECRET;

const app = express();
app.use(express.json());
app.use("/api/payments", paymentRoutes);

const orderId = new mongoose.Types.ObjectId();

function makeOrder(overrides = {}) {
  return {
    _id: orderId,
    orderNumber: "YDS-VERIFY-001",
    paymentMethod: "Razorpay",
    razorpayOrderId: "order_test_123",
    razorpayPaymentId: null,
    paymentStatus: "Pending",
    status: "Placed",
    totalAmount: 647,
    stockReserved: true,
    stockRestocked: false,
    reservationExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    ...overrides,
  };
}

function makeSignature(paymentId = "pay_test_123") {
  return crypto
    .createHmac("sha256", SECRET)
    .update(`order_test_123|${paymentId}`)
    .digest("hex");
}

function makePaidOrder(paymentId = "pay_test_123") {
  return makeOrder({
    paymentStatus: "Paid",
    razorpayPaymentId: paymentId,
  });
}

async function verifyPayment(paymentId = "pay_test_123") {
  return request(app)
    .post("/api/payments/verify")
    .send({
      orderId: String(orderId),
      razorpay_order_id: "order_test_123",
      razorpay_payment_id: paymentId,
      razorpay_signature: makeSignature(paymentId),
    });
}

describe("Razorpay payment verification idempotency", () => {
  let session;
  let razorpay;
  let order;

  beforeEach(() => {
    jest.clearAllMocks();

    order = makeOrder();

    session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };

    jest.spyOn(mongoose, "startSession").mockResolvedValue(session);

    razorpay = {
      payments: {
        fetch: jest.fn().mockResolvedValue({
          id: "pay_test_123",
          order_id: "order_test_123",
          amount: 64700,
          currency: "INR",
          status: "captured",
        }),
      },
    };

    getRazorpayClient.mockReturnValue(razorpay);
    Order.findById.mockResolvedValue(order);

    Order.findOneAndUpdate.mockResolvedValue(
      makePaidOrder()
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("accepts payment when webhook marked the same payment Paid first", async () => {
    Order.findOneAndUpdate.mockResolvedValueOnce(null);

    Order.findOne.mockReturnValue({
      session: jest.fn().mockResolvedValue(makePaidOrder()),
    });

    const response = await verifyPayment();

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.paymentStatus).toBe("Paid");

    expect(Order.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  test("accepts repeated verification of the same payment", async () => {
    const firstResponse = await verifyPayment();
    const secondResponse = await verifyPayment();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    expect(firstResponse.body.paymentStatus).toBe("Paid");
    expect(secondResponse.body.paymentStatus).toBe("Paid");

    expect(Order.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  test("rejects a different payment ID returned by Razorpay", async () => {
    razorpay.payments.fetch.mockResolvedValue({
      id: "pay_different_456",
      order_id: "order_test_123",
      amount: 64700,
      currency: "INR",
      status: "captured",
    });

    const response = await verifyPayment("pay_test_123");

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);

    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
    expect(mongoose.startSession).not.toHaveBeenCalled();
  });
});
