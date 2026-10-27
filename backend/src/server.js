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

// Allowed frontend origins
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "https://your-divine-store.sumitxsingh01.workers.dev",
  process.env.FRONTEND_URL,
].filter(Boolean);

// CORS middleware — must run before API routes
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests without an Origin header, such as server-to-server requests
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn("CORS blocked origin:", origin);
      return callback(new Error("Origin not allowed by CORS"));
    },
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
    credentials: false,
    optionsSuccessStatus: 204,
  })
);

// Preserve raw body for Razorpay webhook signature verification
app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json" })
);

// Parse JSON for other API routes
app.use(express.json());

// Home route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Your Divine Store API is running",
  });
});

// Health route
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

// Mount API routes
app.use("/api/payments", paymentRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/images", imageRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);

// Start server after MongoDB connects
async function startServer() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing from backend/.env");
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected successfully");

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

    // Repeat cleanup every 60 seconds
    const reservationCleanupTimer = setInterval(
      cleanupExpiredReservations,
      60 * 1000
    );

    reservationCleanupTimer.unref();

    // Render provides PORT automatically
    const port = process.env.PORT || 5000;

    app.listen(port, "0.0.0.0", () => {
      console.log(`API server listening on port ${port}`);
    });
  } catch (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  }
}

startServer();