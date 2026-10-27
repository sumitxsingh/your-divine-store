
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");

// Release expired Razorpay reservations one order at a time.
// Run only when MongoDB is connected to the intended database.
async function releaseExpiredReservations() {
  const now = new Date();

  const expiredOrders = await Order.find({
    paymentMethod: "Razorpay",
    paymentStatus: "Pending",
    status: { $ne: "Cancelled" },
    stockReserved: true,
    stockRestocked: false,
    reservationExpiresAt: { $lte: now },
  }).select("_id");

  let releasedCount = 0;

  for (const candidate of expiredOrders) {
    const session = await mongoose.startSession();

    try {
      let released = false;

      await session.withTransaction(async () => {
        // Claim this reservation with a conditional state transition.
        // Concurrent verification/cancellation cannot successfully claim
        // the same pending reservation.
        const order = await Order.findOneAndUpdate(
          {
            _id: candidate._id,
            paymentMethod: "Razorpay",
            paymentStatus: "Pending",
            status: { $ne: "Cancelled" },
            stockReserved: true,
            stockRestocked: false,
            reservationExpiresAt: { $lte: new Date() },
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
              `Product not found while restoring stock: ${item.productId}`
            );
          }
        }

        released = true;
      });

      if (released) releasedCount += 1;
    } finally {
      await session.endSession();
    }
  }

  return releasedCount;
}

module.exports = { releaseExpiredReservations };
