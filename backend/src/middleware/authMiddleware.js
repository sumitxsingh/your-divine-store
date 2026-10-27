
const jwt = require("jsonwebtoken");

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Please log in as admin.",
    });
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    return res.status(500).json({
      success: false,
      message: "Authentication is not configured securely.",
    });
  }

  try {
    const payload = jwt.verify(token, secret, {
    issuer: "your-divine-store",
    audience: "your-divine-store-admin",
    });

    if (payload.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required.",
      });
    }

    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Session expired or token is invalid. Please log in again.",
    });
  }
}

module.exports = requireAdmin;
