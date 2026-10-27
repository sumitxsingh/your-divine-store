
const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

const router = express.Router();

// Limit repeated login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later.",
  },
});

function safeCompare(a, b) {
  const first = Buffer.from(a, "utf8");
  const second = Buffer.from(b, "utf8");

  return (
    first.length === second.length &&
    crypto.timingSafeEqual(first, second)
  );
}

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const jwtSecret = process.env.JWT_SECRET;

    if (
      !adminEmail ||
      !adminPassword ||
      !jwtSecret ||
      jwtSecret.length < 32
    ) {
      return res.status(500).json({
        success: false,
        message: "Admin authentication is not configured correctly.",
      });
    }

    if (
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const emailMatches = safeCompare(
      email.trim().toLowerCase(),
      adminEmail.trim().toLowerCase()
    );

    const passwordMatches = safeCompare(
      password,
      adminPassword
    );

    if (!emailMatches || !passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const token = jwt.sign(
      {
        role: "admin",
        email: adminEmail.trim().toLowerCase(),
      },
      jwtSecret,
      {
        expiresIn: "2h",
        issuer: "your-divine-store",
        audience: "your-divine-store-admin",
      }
    );

    res.set("Cache-Control", "no-store");

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      expiresIn: 7200,
    });
  } catch (error) {
    console.error("Admin login failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to log in.",
    });
  }
});

module.exports = router;
