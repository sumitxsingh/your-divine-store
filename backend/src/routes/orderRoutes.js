
const express = require("express");
const mongoose = require("mongoose");
const { claimRefund } = require("../services/refundService");
const Order = require("../models/Order");
const Product = require("../models/Product");
const requireAdmin = require("../middleware/authMiddleware");

const router = express.Router();

// Create a COD order and reduce product stock.
router.post("/", async (req, res) => {
  const { customer, shippingAddress, items } = req.body || {};

  if (
    !customer?.name?.trim() ||
    !customer?.phone?.trim() ||
    !shippingAddress?.address?.trim() ||
    !shippingAddress?.city?.trim() ||
    !shippingAddress?.state?.trim() ||
    !shippingAddress?.pincode?.trim()
  ) {
    return res.status(400).json({
      success: false,
      message: "Please provide all required customer and shipping details.",
    });
  }

  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > 100
  ) {
    return res.status(400).json({
      success: false,
      message: "Your cart is empty or contains too many items.",
    });
  }

  const quantitiesByProduct = new Map();

  for (const item of items) {
    const productId = String(item?.productId || "");
    const quantity = Number(item?.quantity);

    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID.",
      });
    }

    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid product quantity.",
      });
    }

    quantitiesByProduct.set(
      productId,
      (quantitiesByProduct.get(productId) || 0) + quantity
    );
  }

  const session = await mongoose.startSession();
  let createdOrder;

  try {
    await session.withTransaction(async () => {
      const orderItems = [];
      let subtotal = 0;

      for (const [productId, quantity] of quantitiesByProduct) {
        const product = await Product.findOneAndUpdate(
          {
            _id: productId,
            stock: { $gte: quantity },
            isActive: { $ne: false },
          },
          {
            $inc: { stock: -quantity },
          },
          {
            new: true,
            session,
          }
        );

        if (!product) {
          const error = new Error(
            "A product is unavailable or has insufficient stock."
          );
          error.statusCode = 409;
          throw error;
        }

        const price = Number(product.price);

        if (!Number.isFinite(price) || price < 0) {
          throw new Error(
            `Invalid price configured for product: ${product.name}`
          );
        }

        const itemSubtotal = price * quantity;
        subtotal += itemSubtotal;

        if (!Number.isFinite(subtotal)) {
          throw new Error("Order amount is too large.");
        }

        orderItems.push({
          productId: product._id,
          name: product.name,
          image: product.image || "",
          price,
          quantity,
          subtotal: itemSubtotal,
        });
      }

      const FREE_SHIPPING_THRESHOLD = 599;
      const SHIPPING_CHARGE = 49;

      const shippingCharge =
        subtotal >= FREE_SHIPPING_THRESHOLD
          ? 0
          : SHIPPING_CHARGE;

      const totalAmount = subtotal + shippingCharge;

      if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        const error = new Error("Order total must be greater than zero.");
        error.statusCode = 400;
        throw error;
      }

      const orderNumber =
        `YDS-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)
          .toUpperCase()}`;

      const [order] = await Order.create(
        [
          {
            orderNumber,
            customer: {
              name: customer.name.trim(),
              phone: customer.phone.trim(),
              email: customer.email?.trim() || "",
            },
            shippingAddress: {
              address: shippingAddress.address.trim(),
              city: shippingAddress.city.trim(),
              state: shippingAddress.state.trim(),
              pincode: shippingAddress.pincode.trim(),
              country: shippingAddress.country?.trim() || "India",
            },
            items: orderItems,
            subtotal,
            shippingCharge,
            totalAmount,
            paymentMethod: "COD",
            paymentStatus: "Pending",
            status: "Placed",
            stockReserved: false,
            stockRestocked: false,
          },
        ],
        { session }
      );

      createdOrder = order;
    });

    return res.status(201).json({
      success: true,
      message: "Order placed successfully.",
      order: createdOrder,
    });
  } catch (error) {
    console.error("Order creation failed:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Could not place your order. Please try again.",
    });
  } finally {
    await session.endSession();
  }
});

// Admin: get all orders.
router.get("/", requireAdmin, async (req, res) => {
  try {
    const orders = await Order.find({})
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error("Fetching orders failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not fetch orders.",
    });
  }
});

// Admin: update status, restore stock when cancelling,
// and trigger Razorpay refund if payment was captured.
router.patch("/:id/status", requireAdmin, async (req, res) => {
  let session;

  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID.",
      });
    }

    const { status } = req.body || {};

    const allowedStatuses = [
      "Confirmed",
      "Shipped",
      "Delivered",
      "Cancelled",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order status.",
      });
    }

    session = await mongoose.startSession();

    let updatedOrder;
    let refundResult = null;

    await session.withTransaction(async () => {
      const order = await Order.findById(req.params.id).session(session);

      if (!order) {
        const error = new Error("Order not found.");
        error.statusCode = 404;
        throw error;
      }

      const transitions = {
        Placed: ["Confirmed", "Cancelled"],
        Confirmed: ["Shipped", "Cancelled"],
        Shipped: ["Delivered"],
        Delivered: [],
        Cancelled: [],
      };

      if (
        order.paymentMethod === "Razorpay" &&
        order.paymentStatus !== "Paid" &&
        status !== "Cancelled"
      ) {
        const error = new Error(
          "Razorpay payment must be verified before confirming or shipping this order."
        );

        error.statusCode = 409;
        throw error;
      }

      if (!transitions[order.status]?.includes(status)) {
        const error = new Error(
          `Cannot change order status from ${order.status} to ${status}.`
        );

        error.statusCode = 409;
        throw error;
      }

      // Restore stock only once when cancelling.
      if (status === "Cancelled") {
        if (!order.stockRestocked) {
          for (const item of order.items) {
            const result = await Product.updateOne(
              { _id: item.productId },
              { $inc: { stock: item.quantity } },
              { session }
            );

            if (result.matchedCount !== 1) {
              throw new Error(
                `Product not found while restoring stock: ${item.name}`
              );
            }
          }

          order.stockRestocked = true;
        }

        // A cancelled order must not retain an active reservation.
        order.stockReserved = false;
      }

      order.status = status;

      await order.save({ session });

      updatedOrder = order;
    });

    // Trigger refund only after the cancellation transaction commits.
    if (
      status === "Cancelled" &&
      updatedOrder.paymentMethod === "Razorpay" &&
      updatedOrder.paymentStatus === "Paid"
    ) {
      try {
        refundResult = await claimRefund(updatedOrder._id);
      } catch (refundErr) {
        // Cancellation and stock restoration are already committed.
        console.error(
          "Razorpay refund trigger error:",
          refundErr.message
        );

        refundResult = {
          required: true,
          pending: true,
          message:
            "Refund needs reconciliation. Check the order and Razorpay Dashboard before retrying.",
        };
      }
    }

    return res.json({
      success: true,
      message:
        status === "Cancelled"
          ? "Order cancelled and stock restored. Check the refund field for its current status."
          : "Order status updated successfully.",
      order: updatedOrder.toObject(),
      refund: refundResult,
    });
  } catch (error) {
    console.error("Order status update failed:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Could not update order status.",
    });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
});

module.exports = router;
