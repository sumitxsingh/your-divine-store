require("dotenv").config({
  path: require("path").join(__dirname, "../.env"),
});

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const paymentRoutes = require("./routes/paymentRoutes");
const imageRoutes = require("./routes/imageRoutes");
const productRoutes = require("./routes/productRoutes");
const authRoutes = require("./routes/authRoutes");
const orderRoutes = require("./routes/orderRoutes");

const {
  releaseExpiredReservations,
} = require("./services/paymentReservationService");

const app = express();

// 1. CORS configuration
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5174",
      process.env.FRONTEND_URL,
    ].filter(Boolean),
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// 2. Preserve the raw body for Razorpay webhook signature verification
app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json" })
);

// 3. Parse JSON for all other API routes
app.use(express.json());

// 3. Home route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Your Divine Store API is running",
  });
});

// 4. Health route
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    api: "online",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
  });
});

// 5. Mount API routes
app.use("/api/payments", paymentRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/images", imageRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);

// 6. Start server after MongoDB connects
async function startServer() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing from backend/.env");
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected successfully");

    // Release expired Razorpay reservations
    async function cleanupExpiredReservations() {
      try {
        const releasedCount = await releaseExpiredReservations();

        if (releasedCount > 0) {
          console.log(
            `Released ${releasedCount} expired Razorpay reservation(s)`
          );
        }
      } catch (error) {
        console.error(
          "Razorpay reservation cleanup failed:",
          error.message
        );
      }
    }

    // Run cleanup once after connecting
    await cleanupExpiredReservations();

    // Run cleanup every 60 seconds
    const reservationCleanupTimer = setInterval(
      cleanupExpiredReservations,
      60 * 1000
    );

    // Timer should not keep Node.js alive by itself
    reservationCleanupTimer.unref();

    // Start HTTP server
    const port = process.env.PORT || 5000;

    app.listen(port, () => {
      console.log(`API running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  }
}

startServer();