
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
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength;
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

// Restores reserved inventory and cancels a still-pending order exactly once.
// The conditional order update and stock restoration share one transaction.
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
          throw new Error(`Product missing while restoring stock: ${item.productId}`);
        }
      }
    });
  } finally {
    await session.endSession();
  }
}

// Create a local order and reserve stock first.
// The Razorpay API call is deliberately outside the MongoDB transaction.
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

  // Combine duplicate cart lines before checking/reserving inventory.
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
          { _id: product._id, stock: { $gte: quantity }, isActive: { $ne: false } },
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

      // Current store checkout has free shipping.
      const shippingCharge = 0;
      const totalPaise = subtotalPaise;

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
            shippingCharge,
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
      // The reservation expired or was cancelled while Razorpay was responding.
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

// Verify the checkout signature, then independently confirm payment with Razorpay.
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

    const secret = process.env.RAZORPAY_KEY_SECRET;
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

    // Do not trust the browser alone: confirm the payment belongs to this
    // Razorpay order and has actually been captured.
    const payment = await razorpay.payments.fetch(razorpayPaymentId);

    if (
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

    try {
      await session.withTransaction(async () => {
        const paidOrder = await Order.findOneAndUpdate(
          {
            _id: order._id,
            paymentMethod: "Razorpay",
            razorpayOrderId,
            paymentStatus: "Pending",
            status: { $ne: "Cancelled" },
            stockReserved: true,
            stockRestocked: false,
            reservationExpiresAt: { $gt: new Date() },
          },
          { $set: { paymentStatus: "Paid" } },
          { new: true, session }
        );

        if (!paidOrder) {
          throw httpError(
            409,
            "Reservation expired or order is no longer payable. Contact support if money was deducted."
          );
        }
      });
    } finally {
      await session.endSession();
    }

    return res.json({
      success: true,
      message: "Payment verified successfully.",
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


/**
 * Razorpay webhook.
 * Requires express.raw() middleware before express.json() in server.js.
 * Uses RAZORPAY_WEBHOOK_SECRET, NOT RAZORPAY_KEY_SECRET.
 */
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

    const event = JSON.parse(rawBody.toString("utf8"));

    // Only captured payments can mark an order as paid.
    if (event.event !== "payment.captured") {
      return res.status(200).json({
        success: true,
        message: "Event acknowledged; no action required.",
      });
    }

    const payment = event.payload?.payment?.entity;

    if (
      !payment?.order_id ||
      !payment?.id ||
      payment.status !== "captured" ||
      !Number.isSafeInteger(payment.amount) ||
      payment.currency !== "INR"
    ) {
      console.error("Razorpay webhook contains invalid payment details.");
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

      // Acknowledge to avoid endless retries. Investigate this payment manually.
      return res.status(200).json({
        success: true,
        message: "Payment acknowledged for reconciliation.",
      });
    }

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

    // Repeated delivery of an already-processed event is harmless.
    if (order.paymentStatus === "Paid") {
      return res.status(200).json({
        success: true,
        message: "Payment already processed.",
      });
    }

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const updatedOrder = await Order.findOneAndUpdate(
          {
            _id: order._id,
            razorpayOrderId: payment.order_id,
            paymentMethod: "Razorpay",
            paymentStatus: "Pending",
            status: { $ne: "Cancelled" },
            stockReserved: true,
            stockRestocked: false,
            reservationExpiresAt: { $gt: new Date() },
          },
          {
            $set: { paymentStatus: "Paid" },
          },
          { new: true, session }
        );

        if (!updatedOrder) {
          throw new Error("ORDER_REQUIRES_RECONCILIATION");
        }
      });
    } finally {
      await session.endSession();
    }

    console.log("Razorpay webhook marked order paid:", order.orderNumber);

    return res.status(200).json({
      success: true,
      message: "Payment processed.",
    });
  } catch (error) {
    if (error.message === "ORDER_REQUIRES_RECONCILIATION") {
      console.error(
        "Captured payment needs manual reconciliation:",
        payment?.id
      );

      return res.status(200).json({
        success: true,
        message: "Payment acknowledged for reconciliation.",
      });
    }

    console.error("Razorpay webhook processing failed:", error.message);

    // A server-side processing error can be retried by Razorpay.
    return res.status(500).json({
      success: false,
      message: "Webhook processing failed.",
    });
  }
});


module.exports = router;
