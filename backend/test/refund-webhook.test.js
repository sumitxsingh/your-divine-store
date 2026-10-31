
jest.mock("../src/models/Order", () => ({
  findOneAndUpdate: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock("../src/models/Product", () => ({
  updateOne: jest.fn(),
}));

jest.mock("../src/config/razorpay", () => ({
  getRazorpayClient: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const crypto = require("crypto");

const Order = require("../src/models/Order");
const paymentRoutes = require("../src/routes/paymentRoutes");

const app = express();

// Match the production webhook middleware order.
app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json" })
);

app.use(express.json());

app.use("/api/payments", paymentRoutes);

const webhookSecret = "test_webhook_secret";
const paymentId = "pay_test123";
const refundId = "rfnd_test123";

function makeRefundEvent(eventName, overrides = {}) {
  const isProcessed = eventName === "refund.processed";

  return {
    event: eventName,
    payload: {
      refund: {
        entity: {
          id: refundId,
          payment_id: paymentId,
          status: isProcessed ? "processed" : "failed",
          amount: 64700,
          currency: "INR",
          ...overrides,
        },
      },
    },
  };
}

function signPayload(rawBody) {
  return crypto
    .createHmac("sha256", webhookSecret)
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

describe("Razorpay refund webhooks", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;
  });

  afterAll(() => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  test("marks an order Processed for a valid refund.processed event", async () => {
    Order.findOneAndUpdate.mockResolvedValue({
      orderNumber: "YDS-TEST-001",
      refundStatus: "Processed",
    });

    const response = await sendWebhook(
      makeRefundEvent("refund.processed")
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Refund event processed.",
    });

    expect(Order.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        razorpayPaymentId: paymentId,
        paymentMethod: "Razorpay",
        paymentStatus: "Paid",
        status: "Cancelled",
        refundAmount: 64700,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          refundStatus: "Processed",
          razorpayRefundId: refundId,
        }),
      }),
      { new: true }
    );
  });

  test("marks an order Failed for a valid refund.failed event", async () => {
    Order.findOneAndUpdate.mockResolvedValue({
      orderNumber: "YDS-TEST-002",
      refundStatus: "Failed",
    });

    const response = await sendWebhook(
      makeRefundEvent("refund.failed", {
        error_description: "Bank rejected the refund",
      })
    );

    expect(response.status).toBe(200);

    expect(Order.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          refundStatus: "Failed",
          razorpayRefundId: refundId,
          refundError: "Bank rejected the refund",
        }),
      }),
      { new: true }
    );
  });

  test("rejects a webhook with an invalid signature", async () => {
    const response = await sendWebhook(
      makeRefundEvent("refund.processed"),
      "a".repeat(64)
    );

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid webhook signature.");
    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("acknowledges a duplicate already-processed refund event", async () => {
    Order.findOneAndUpdate.mockResolvedValue(null);

    Order.findOne.mockResolvedValue({
      refundStatus: "Processed",
      razorpayRefundId: refundId,
    });

    const response = await sendWebhook(
      makeRefundEvent("refund.processed")
    );

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Refund event already processed.");
    expect(Order.findOne).toHaveBeenCalled();
  });

  test("does not overwrite a Failed refund with a later event for the same refund ID", async () => {
    Order.findOneAndUpdate.mockResolvedValue(null);

    Order.findOne.mockResolvedValue({
      refundStatus: "Failed",
      razorpayRefundId: refundId,
    });

    const response = await sendWebhook(
      makeRefundEvent("refund.processed")
    );

    expect(response.status).toBe(200);
    expect(response.body.message).toBe(
      "Refund acknowledged for reconciliation."
    );

    expect(Order.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        refundStatus: { $in: ["Processing", "Pending"] },
      }),
      expect.any(Object),
      { new: true }
    );
  });
});
