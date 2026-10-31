
const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");

const Order = require("../models/Order");
const Product = require("../models/Product");
const { getRazorpayClient } = require("../config/razorpay");

const router = express.Router();

const RESERVATION_MINUTES = 15;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function newOrderNumber() {
  return `YDS-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function validText(value, maxLength = 200) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength
  );
}

function validCustomerAndAddress(customer, address) {
  return (
    customer &&
    validText(customer.name, 100) &&
    validText(customer.phone, 20) &&
    (!customer.email ||
      (typeof customer.email === "string" &&
        customer.email.length <= 254)) &&
    address &&
    validText(address.address, 300) &&
    validText(address.city, 100) &&
    validText(address.state, 100) &&
    /^[0-9]{6}$/.test(String(address.pincode || "").trim())
  );
}

// Restore reserved inventory and cancel a pending order exactly once.
async function cancelAndReleaseReservation(orderId) {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const order = await Order.findOneAndUpdate(
        {
          _id: orderId,
          paymentMethod: "Razorpay",
          paymentStatus: "Pending",
          status: { $ne: "Cancelled" },
          stockReserved: true,
          stockRestocked: false,
        },
        {
          $set: {
            status: "Cancelled",
            stockReserved: false,
            stockRestocked: true,
          },
        },
        { new: true, session }
      );

      if (!order) return;

      for (const item of order.items) {
        const result = await Product.updateOne(
          { _id: item.productId },
          { $inc: { stock: item.quantity } },
          { session }
        );

        if (result.matchedCount !== 1) {
          throw new Error(
            `Product missing while restoring stock: ${item.productId}`
          );
        }
      }
    });
  } finally {
    await session.endSession();
  }
}

// CREATE RAZORPAY ORDER
router.post("/create-order", async (req, res) => {
  const { customer, shippingAddress, items } = req.body || {};

  if (!validCustomerAndAddress(customer, shippingAddress)) {
    return res.status(400).json({
      success: false,
      message: "Please provide valid customer and shipping details.",
    });
  }

  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    return res.status(400).json({
      success: false,
      message: "Cart items are required.",
    });
  }

  if (
    items.some(
      (item) =>
        !item ||
        !mongoose.Types.ObjectId.isValid(
          item.productId || item.product || item._id
        ) ||
        !Number.isInteger(Number(item.quantity)) ||
        Number(item.quantity) < 1 ||
        Number(item.quantity) > 10
    )
  ) {
    return res.status(400).json({
      success: false,
      message: "One or more cart items are invalid.",
    });
  }

  let razorpay;

  try {
    razorpay = getRazorpayClient();
  } catch {
    return res.status(503).json({
      success: false,
      message: "Online payment is not configured.",
    });
  }

  // Combine duplicate cart lines.
  const quantities = new Map();

  for (const item of items) {
    const id = String(item.productId || item.product || item._id);
    quantities.set(id, (quantities.get(id) || 0) + Number(item.quantity));
  }

  if ([...quantities.values()].some((quantity) => quantity > 10)) {
    return res.status(400).json({
      success: false,
      message: "Maximum quantity per product is 10.",
    });
  }

  const session = await mongoose.startSession();
  let order;

  try {
    await session.withTransaction(async () => {
      const orderItems = [];
      let subtotalPaise = 0;

      for (const [id, quantity] of quantities) {
        const product = await Product.findOne({
          _id: id,
          isActive: { $ne: false },
        }).session(session);

        if (!product) {
          throw httpError(404, "A cart product is unavailable.");
        }

        const pricePaise = Math.round(Number(product.price) * 100);

        if (!Number.isSafeInteger(pricePaise) || pricePaise < 0) {
          throw new Error("Invalid product price.");
        }

        const stockUpdate = await Product.updateOne(
          {
            _id: product._id,
            stock: { $gte: quantity },
            isActive: { $ne: false },
          },
          { $inc: { stock: -quantity } },
          { session }
        );

        if (stockUpdate.modifiedCount !== 1) {
          throw httpError(409, `Insufficient stock for ${product.name}.`);
        }

        const linePaise = pricePaise * quantity;
        subtotalPaise += linePaise;

        if (!Number.isSafeInteger(subtotalPaise)) {
          throw new Error("Order amount is too large.");
        }

        orderItems.push({
          productId: product._id,
          name: product.name,
          image: product.image || "",
          price: pricePaise / 100,
          quantity,
          subtotal: linePaise / 100,
        });
      }

      const FREE_SHIPPING_THRESHOLD_PAISE = 59900;
      const SHIPPING_CHARGE_PAISE = 4900;

      const shippingChargePaise =
        subtotalPaise >= FREE_SHIPPING_THRESHOLD_PAISE
          ? 0
          : SHIPPING_CHARGE_PAISE;

      const totalPaise = subtotalPaise + shippingChargePaise;

      if (totalPaise <= 0 || !Number.isSafeInteger(totalPaise)) {
        throw httpError(400, "Order total must be greater than zero.");
      }

      const [createdOrder] = await Order.create(
        [
          {
            orderNumber: newOrderNumber(),
            customer: {
              name: customer.name.trim(),
              phone: customer.phone.trim(),
              email: (customer.email || "").trim().toLowerCase(),
            },
            shippingAddress: {
              address: shippingAddress.address.trim(),
              city: shippingAddress.city.trim(),
              state: shippingAddress.state.trim(),
              pincode: String(shippingAddress.pincode).trim(),
              country: "India",
            },
            items: orderItems,
            subtotal: subtotalPaise / 100,
            shippingCharge: shippingChargePaise / 100,
            totalAmount: totalPaise / 100,
            paymentMethod: "Razorpay",
            paymentStatus: "Pending",
            status: "Placed",
            stockReserved: true,
            stockRestocked: false,
            reservationExpiresAt: new Date(
              Date.now() + RESERVATION_MINUTES * 60 * 1000
            ),
          },
        ],
        { session }
      );

      order = createdOrder;
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message:
        error.status && error.status < 500
          ? error.message
          : "Unable to reserve stock for this order.",
    });
  } finally {
    await session.endSession();
  }

  try {
    const amount = Math.round(order.totalAmount * 100);

    const razorpayOrder = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: order.orderNumber,
      notes: { storeOrderId: String(order._id) },
    });

    const savedOrder = await Order.findOneAndUpdate(
      {
        _id: order._id,
        paymentStatus: "Pending",
        status: "Placed",
        stockReserved: true,
        stockRestocked: false,
        reservationExpiresAt: { $gt: new Date() },
      },
      { $set: { razorpayOrderId: razorpayOrder.id } },
      { new: true }
    );

    if (!savedOrder) {
      return res.status(409).json({
        success: false,
        message: "The reservation expired. Please create a new order.",
      });
    }

    return res.status(201).json({
      success: true,
      orderId: String(savedOrder._id),
      orderNumber: savedOrder.orderNumber,
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("Razorpay order creation failed:", error.message);

    try {
      await cancelAndReleaseReservation(order._id);
    } catch (releaseError) {
      console.error("Reservation release failed:", releaseError.message);
    }

    return res.status(502).json({
      success: false,
      message: "Unable to start payment. Please try again.",
    });
  }
});

// VERIFY CHECKOUT PAYMENT
router.post("/verify", async (req, res) => {
  const {
    orderId,
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    razorpay_signature: signature,
  } = req.body || {};

  if (
    !mongoose.Types.ObjectId.isValid(orderId) ||
    !validText(razorpayOrderId, 100) ||
    !validText(razorpayPaymentId, 100) ||
    !validText(signature, 256) ||
    !/^[a-f0-9]{64}$/i.test(signature)
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid payment verification details.",
    });
  }

  const secret = process.env.RAZORPAY_KEY_SECRET;

  if (!secret) {
    return res.status(503).json({
      success: false,
      message: "Online payment is not configured.",
    });
  }

  let razorpay;

  try {
    razorpay = getRazorpayClient();
  } catch {
    return res.status(503).json({
      success: false,
      message: "Online payment is not configured.",
    });
  }

  try {
    const order = await Order.findById(orderId);

    if (
      !order ||
      order.paymentMethod !== "Razorpay" ||
      order.razorpayOrderId !== razorpayOrderId
    ) {
      return res.status(404).json({
        success: false,
        message: "Payment order not found.",
      });
    }

    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest();

    const supplied = Buffer.from(signature, "hex");

    if (
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment signature verification failed.",
      });
    }

    const payment = await razorpay.payments.fetch(razorpayPaymentId);
    if (
      payment.id !== razorpayPaymentId ||
      payment.order_id !== razorpayOrderId ||
      payment.status !== "captured" ||
      payment.amount !== Math.round(order.totalAmount * 100) ||
      payment.currency !== "INR"
    ) {
      return res.status(409).json({
        success: false,
        message: "Payment is not captured or its details do not match.",
      });
    }

    const session = await mongoose.startSession();
    let alreadyPaid = false;

    try {
      await session.withTransaction(async () => {
        const paidOrder = await Order.findOneAndUpdate(
          {
            _id: order._id,
            paymentMethod: "Razorpay",
            razorpayOrderId,
            paymentStatus: "Pending",
            status: "Placed",
            stockReserved: true,
            stockRestocked: false,
            reservationExpiresAt: { $gt: new Date() },
          },
          {
            $set: {
              paymentStatus: "Paid",
              razorpayPaymentId,
            },
          },
          { new: true, session }
        );

        if (paidOrder) {
          return;
        }

        // Webhook may have processed this exact payment first.
        const existingPaidOrder = await Order.findOne({
          _id: order._id,
          paymentMethod: "Razorpay",
          razorpayOrderId,
          paymentStatus: "Paid",
          razorpayPaymentId,
        }).session(session);

        if (existingPaidOrder) {
          alreadyPaid = true;
          return;
        }

        throw httpError(
          409,
          "Reservation expired or order is no longer payable. Contact support if money was deducted."
        );
      });
    } finally {
      await session.endSession();
    }
    return res.json({
      success: true,
      message: alreadyPaid
        ? "Payment was already verified successfully."
        : "Payment verified successfully.",
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      paymentStatus: "Paid",
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        message: error.message,
      });
    }

    console.error("Payment verification failed:", error.message);

    return res.status(502).json({
      success: false,
      message: "Unable to verify payment right now. Please contact support.",
    });
  }
});

// RAZORPAY WEBHOOK
// server.js must apply express.raw() before express.json() for this route.
router.post("/webhook", async (req, res) => {
  const rawBody = req.body;
  const signature = req.get("x-razorpay-signature");
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!Buffer.isBuffer(rawBody)) {
    return res.status(400).json({
      success: false,
      message: "Webhook raw body is unavailable.",
    });
  }

  if (!webhookSecret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    return res.status(400).json({
      success: false,
      message: "Invalid webhook configuration or signature.",
    });
  }

  let event;

  try {
    const expected = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest();

    const supplied = Buffer.from(signature, "hex");

    if (
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid webhook signature.",
      });
    }

    event = JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return res.status(400).json({
        success: false,
        message: "Invalid webhook JSON.",
      });
    }

    console.error("Webhook signature verification failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Webhook verification failed.",
    });
  }

  try {
    // HANDLE REFUND EVENTS
    if (
      event.event === "refund.processed" ||
      event.event === "refund.failed"
    ) {
      const refund = event.payload?.refund?.entity;

      const expectedStatus =
        event.event === "refund.processed" ? "processed" : "failed";

      if (
        !refund?.id ||
        !refund?.payment_id ||
        refund.status !== expectedStatus ||
        !Number.isSafeInteger(refund.amount) ||
        refund.amount <= 0 ||
        refund.currency !== "INR"
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid refund webhook payload.",
        });
      }

      const refundUpdate =
        expectedStatus === "processed"
          ? {
              $set: {
                refundStatus: "Processed",
                razorpayRefundId: refund.id,
                refundError: "",
              },
            }
          : {
              $set: {
                refundStatus: "Failed",
                razorpayRefundId: refund.id,
                refundError: String(
                  refund.error_description ||
                    refund.error_reason ||
                    "Razorpay reported that the refund failed."
                ).slice(0, 500),
              },
            };

      const updatedOrder = await Order.findOneAndUpdate(
        {
          razorpayPaymentId: refund.payment_id,
          paymentMethod: "Razorpay",
          paymentStatus: "Paid",
          status: "Cancelled",
          refundAmount: refund.amount,
          refundStatus: { $in: ["Processing", "Pending"] },
          $or: [
            { razorpayRefundId: null },
            { razorpayRefundId: refund.id },
          ],
        },
        refundUpdate,
        { new: true }
      );

      if (!updatedOrder) {
        const existingOrder = await Order.findOne({
          razorpayPaymentId: refund.payment_id,
          paymentMethod: "Razorpay",
        });

        if (
          existingOrder?.refundStatus === "Processed" &&
          existingOrder.razorpayRefundId === refund.id
        ) {
          return res.status(200).json({
            success: true,
            message: "Refund event already processed.",
          });
        }

        console.error(
          "Refund webhook needs manual reconciliation:",
          refund.id,
          refund.payment_id
        );

        return res.status(200).json({
          success: true,
          message: "Refund acknowledged for reconciliation.",
        });
      }

      console.log(
        "Razorpay refund status updated:",
        updatedOrder.orderNumber,
        updatedOrder.refundStatus
      );

      return res.status(200).json({
        success: true,
        message: "Refund event processed.",
      });
    }

    // IGNORE OTHER EVENTS
    if (event.event !== "payment.captured") {
      return res.status(200).json({
        success: true,
        message: "Event acknowledged; no action required.",
      });
    }

    // HANDLE CAPTURED PAYMENT
    
    // HANDLE CAPTURED PAYMENT
    const payment = event.payload?.payment?.entity;

    if (
      !payment?.order_id ||
      !payment?.id ||
      payment.status !== "captured" ||
      !Number.isSafeInteger(payment.amount) ||
      payment.amount <= 0 ||
      payment.currency !== "INR"
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid captured-payment payload.",
      });
    }

    const order = await Order.findOne({
      razorpayOrderId: payment.order_id,
      paymentMethod: "Razorpay",
    });

    if (!order) {
      console.error(
        "Captured payment has no matching store order:",
        payment.order_id,
        payment.id
      );

      return res.status(200).json({
        success: true,
        message: "Payment acknowledged for reconciliation.",
      });
    }

    // Verify exact amount.
    if (payment.amount !== Math.round(order.totalAmount * 100)) {
      console.error(
        "Captured payment amount mismatch:",
        order.orderNumber,
        payment.id
      );

      return res.status(200).json({
        success: true,
        message: "Payment acknowledged for reconciliation.",
      });
    }

    // Handle duplicate payment events.
    if (order.paymentStatus === "Paid") {
      if (order.razorpayPaymentId === payment.id) {
        return res.status(200).json({
          success: true,
          message: "Payment already processed.",
        });
      }

      console.error(
        "Different captured payment found for an already-paid order:",
        order.orderNumber,
        payment.id
      );

      return res.status(200).json({
        success: true,
        message: "Payment acknowledged for reconciliation.",
      });
    }

    // Update payment status atomically.
    const session = await mongoose.startSession();
    let paymentUpdated = false;

    try {
      await session.withTransaction(async () => {
        const updatedOrder = await Order.findOneAndUpdate(
          {
            _id: order._id,
            razorpayOrderId: payment.order_id,
            paymentMethod: "Razorpay",
            paymentStatus: "Pending",
            status: "Placed",
            stockReserved: true,
            stockRestocked: false,
            reservationExpiresAt: { $gt: new Date() },
          },
          {
            $set: {
              paymentStatus: "Paid",
              razorpayPaymentId: payment.id,
            },
          },
          { new: true, session }
        );

        paymentUpdated = Boolean(updatedOrder);
      });
    } finally {
      await session.endSession();
    }

    // Do not mark an expired, cancelled or otherwise ineligible order as Paid.
    if (!paymentUpdated) {
      console.error(
        "Captured payment needs manual reconciliation:",
        payment.id,
        order.orderNumber
      );

      return res.status(200).json({
        success: true,
        message: "Payment acknowledged for reconciliation.",
      });
    }

    console.log(
      "Razorpay webhook marked order paid:",
      order.orderNumber
    );

    return res.status(200).json({
      success: true,
      message: "Payment processed.",
    });
  } catch (error) {
    console.error(
      "Razorpay webhook processing failed:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Webhook processing failed.",
    });
  }
});

module.exports = router;
