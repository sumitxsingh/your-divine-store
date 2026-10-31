
const crypto = require("crypto");
const axios = require("axios");
const Order = require("../models/Order");

const RAZORPAY_API = "https://api.razorpay.com/v1";

async function claimRefund(orderId) {
  const order = await Order.findById(orderId);

  if (!order) {
    throw new Error("Order not found.");
  }

  if (
    order.status !== "Cancelled" ||
    order.paymentMethod !== "Razorpay" ||
    order.paymentStatus !== "Paid"
  ) {
    return { required: false };
  }

  if (order.refundStatus === "Processed") {
    return { required: true, processed: true };
  }

  if (
    ["Processing", "Pending", "Failed"].includes(order.refundStatus)
  ) {
    return {
      required: true,
      pending: true,
      message: "Refund needs reconciliation before another attempt.",
    };
  }

  if (!order.razorpayPaymentId) {
    throw new Error("Payment ID missing; manual reconciliation required.");
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured.");
  }

  const expectedAmount = Math.round(order.totalAmount * 100);

  if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0) {
    throw new Error("Invalid refund amount; manual reconciliation required.");
  }

  const paymentResponse = await axios.get(
    `${RAZORPAY_API}/payments/${encodeURIComponent(order.razorpayPaymentId)}`,
    {
      auth: { username: keyId, password: keySecret },
      timeout: 15000,
    }
  );

  const payment = paymentResponse.data;

  if (
    !payment ||
    payment.id !== order.razorpayPaymentId ||
    payment.status !== "captured" ||
    payment.currency !== "INR" ||
    payment.amount !== expectedAmount
  ) {
    throw new Error(
      "Captured payment does not match the order; manual reconciliation required."
    );
  }

  const idempotencyKey = crypto.randomUUID();

  const claimedOrder = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: "Cancelled",
      paymentMethod: "Razorpay",
      paymentStatus: "Paid",
      refundStatus: "NotRequired",
      $or: [
        { refundIdempotencyKey: null },
        { refundIdempotencyKey: { $exists: false } },
      ],
    },
    {
      $set: {
        refundStatus: "Processing",
        refundAmount: expectedAmount,
        refundRequestedAt: new Date(),
        refundIdempotencyKey: idempotencyKey,
        refundError: "",
      },
    },
    { new: true }
  );

  if (!claimedOrder) {
    return {
      required: true,
      pending: true,
      message: "Refund is already claimed or requires reconciliation.",
    };
  }

  try {
    const response = await axios.post(
      `${RAZORPAY_API}/payments/${encodeURIComponent(payment.id)}/refund`,
      {
        amount: expectedAmount,
        notes: {
          orderId: String(claimedOrder._id),
          reason: "Order cancelled by admin",
        },
      },
      {
        auth: { username: keyId, password: keySecret },
        headers: {
          "Content-Type": "application/json",
          "X-Refund-Idempotency": idempotencyKey,
        },
        timeout: 20000,
      }
    );

    const refund = response.data;

    if (
      !refund?.id ||
      refund.payment_id !== payment.id ||
      !["processed", "pending", "failed"].includes(refund.status) ||
      refund.amount !== expectedAmount ||
      refund.currency !== "INR"
    ) {
      throw new Error(
        "Unexpected Razorpay refund response. Manual reconciliation required."
      );
    }

    const mappedStatus = {
      processed: "Processed",
      pending: "Pending",
      failed: "Failed",
    }[refund.status];

    // Update only if the webhook has not already changed the status.
    const savedOrder = await Order.findOneAndUpdate(
      {
        _id: claimedOrder._id,
        refundStatus: "Processing",
        $or: [
          { razorpayRefundId: null },
          { razorpayRefundId: refund.id },
        ],
      },
      {
        $set: {
          razorpayRefundId: refund.id,
          refundStatus: mappedStatus,
          refundError:
            mappedStatus === "Failed"
              ? "Razorpay reported that the refund failed."
              : "",
        },
      },
      { new: true }
    );

    const latestOrder =
      savedOrder ||
      (await Order.findById(claimedOrder._id));

    if (
      !latestOrder ||
      latestOrder.razorpayRefundId !== refund.id
    ) {
      throw new Error(
        "Refund response could not be reconciled with the order."
      );
    }

    return {
      required: true,
      processed: latestOrder.refundStatus === "Processed",
      failed: latestOrder.refundStatus === "Failed",
      pending: ["Pending", "Processing"].includes(
        latestOrder.refundStatus
      ),
      refundId: latestOrder.razorpayRefundId,
    };
  } catch (error) {
    const errorMessage = String(
      error.response?.data?.error?.description ||
      error.message ||
      "Refund result is uncertain"
    ).slice(0, 500);

    // Never overwrite a status already confirmed by a webhook.
    try {
      await Order.updateOne(
        {
          _id: claimedOrder._id,
          refundStatus: "Processing",
        },
        {
          $set: {
            refundError: errorMessage,
          },
        }
      );
    } catch (databaseError) {
      console.error(
        "Refund reconciliation update failed:",
        databaseError.message
      );
    }

    console.error("Refund needs reconciliation:", errorMessage);

    return {
      required: true,
      pending: true,
      message:
        "Refund outcome is unconfirmed. Check Razorpay before retrying.",
    };
  }
}

module.exports = { claimRefund };
