
jest.mock("axios", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock("../src/models/Order", () => ({
  findById: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));

const axios = require("axios");
const Order = require("../src/models/Order");
const { claimRefund } = require("../src/services/refundService");

const orderId = "507f1f77bcf86cd799439011";
const paymentId = "pay_test123";
const refundId = "rfnd_test123";

const expectedAmount = 64700;

function makeOrder(overrides = {}) {
  return {
    _id: orderId,
    status: "Cancelled",
    paymentMethod: "Razorpay",
    paymentStatus: "Paid",
    razorpayPaymentId: paymentId,
    totalAmount: 647,
    refundStatus: "NotRequired",
    ...overrides,
  };
}

function makePayment(overrides = {}) {
  return {
    id: paymentId,
    status: "captured",
    currency: "INR",
    amount: expectedAmount,
    ...overrides,
  };
}

function makeRefund(overrides = {}) {
  return {
    id: refundId,
    payment_id: paymentId,
    status: "processed",
    currency: "INR",
    amount: expectedAmount,
    ...overrides,
  };
}

describe("Refund service - claimRefund", () => {
  beforeEach(() => {
    jest.resetAllMocks();

    process.env.RAZORPAY_KEY_ID = "test_key_id";
    process.env.RAZORPAY_KEY_SECRET = "test_key_secret";
  });

  afterAll(() => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  test("does not request refund for an ineligible order", async () => {
    Order.findById.mockResolvedValue(
      makeOrder({ status: "Placed" })
    );

    const result = await claimRefund(orderId);

    expect(result).toEqual({ required: false });
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("returns processed when refund is already processed", async () => {
    Order.findById.mockResolvedValue(
      makeOrder({ refundStatus: "Processed" })
    );

    const result = await claimRefund(orderId);

    expect(result).toEqual({
      required: true,
      processed: true,
    });

    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test.each(["Processing", "Pending", "Failed"])(
    "does not retry an order with refund status %s",
    async (refundStatus) => {
      Order.findById.mockResolvedValue(
        makeOrder({ refundStatus })
      );

      const result = await claimRefund(orderId);

      expect(result.pending).toBe(true);
      expect(axios.get).not.toHaveBeenCalled();
      expect(axios.post).not.toHaveBeenCalled();
    }
  );

  test("rejects when Razorpay credentials are missing", async () => {
    delete process.env.RAZORPAY_KEY_ID;

    Order.findById.mockResolvedValue(makeOrder());

    await expect(claimRefund(orderId)).rejects.toThrow(
      "Razorpay credentials are not configured."
    );

    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("rejects when payment ID is missing", async () => {
    Order.findById.mockResolvedValue(
      makeOrder({ razorpayPaymentId: null })
    );

    await expect(claimRefund(orderId)).rejects.toThrow(
      "Payment ID missing"
    );

    expect(axios.get).not.toHaveBeenCalled();
  });

  test("rejects when captured payment amount does not match order", async () => {
    Order.findById.mockResolvedValue(makeOrder());

    axios.get.mockResolvedValue({
      data: makePayment({ amount: 100 }),
    });

    await expect(claimRefund(orderId)).rejects.toThrow(
      "Captured payment does not match the order"
    );

    expect(axios.post).not.toHaveBeenCalled();
    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("rejects an uncaptured payment", async () => {
    Order.findById.mockResolvedValue(makeOrder());

    axios.get.mockResolvedValue({
      data: {
        ...makePayment(),
        status: "authorized",
      },
    });

    await expect(claimRefund(orderId)).rejects.toThrow(
      "Captured payment does not match the order"
    );

    expect(axios.post).not.toHaveBeenCalled();
  });

  test("submits a verified refund and saves its processed status", async () => {
    const order = makeOrder();

    Order.findById.mockResolvedValue(order);

    axios.get.mockResolvedValue({
      data: makePayment(),
    });

    Order.findOneAndUpdate
      .mockResolvedValueOnce({
        ...order,
        refundStatus: "Processing",
      })
      .mockResolvedValueOnce({
        ...order,
        refundStatus: "Processed",
        razorpayRefundId: refundId,
      });

    axios.post.mockResolvedValue({
      data: makeRefund(),
    });

    const result = await claimRefund(orderId);

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledTimes(1);

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/payments/pay_test123/refund"),
      expect.objectContaining({
        amount: expectedAmount,
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Refund-Idempotency": expect.any(String),
        }),
      })
    );

    expect(Order.findOneAndUpdate).toHaveBeenCalledTimes(2);

    expect(result).toEqual({
      required: true,
      processed: true,
      failed: false,
      pending: false,
      refundId,
    });
  });

  test("does not call Razorpay when atomic refund claim fails", async () => {
    Order.findById.mockResolvedValue(makeOrder());

    axios.get.mockResolvedValue({
      data: makePayment(),
    });

    Order.findOneAndUpdate.mockResolvedValue(null);

    const result = await claimRefund(orderId);

    expect(result.pending).toBe(true);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("keeps refund pending when Razorpay response is uncertain", async () => {
    Order.findById.mockResolvedValue(makeOrder());

    axios.get.mockResolvedValue({
      data: makePayment(),
    });

    Order.findOneAndUpdate.mockResolvedValueOnce({
      ...makeOrder(),
      refundStatus: "Processing",
    });

    axios.post.mockRejectedValue(
      new Error("Network timeout")
    );

    Order.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const result = await claimRefund(orderId);

    expect(result).toEqual({
      required: true,
      pending: true,
      message:
        "Refund outcome is unconfirmed. Check Razorpay before retrying.",
    });

    expect(Order.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        refundStatus: "Processing",
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          refundError: "Network timeout",
        }),
      })
    );
  });
});
