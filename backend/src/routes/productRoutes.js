const express = require("express");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const requireAdmin = require("../middleware/authMiddleware");

const router = express.Router();

async function deleteGridFSImage(imageUrl) {
  if (!imageUrl || !mongoose.connection.db) return;
  try {
    const url = new URL(imageUrl);
    const match = url.pathname.match(/^\/api\/images\/([a-f\d]{24})$/i);
    if (!match) return; // Never delete external/legacy images.

    const imageId = new mongoose.Types.ObjectId(match[1]);
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: "productImages",
    });
    const exists = await mongoose.connection.db
      .collection("productImages.files")
      .findOne({ _id: imageId });
    if (exists) await bucket.delete(imageId);
  } catch (error) {
    console.error("GridFS image cleanup failed:", error.message);
  }
}

function normalizeImages(body) {
  let images = Array.isArray(body.images) ? body.images : [];
  images = images.filter((value) => typeof value === "string" && value.trim());
  if (body.image && !images.includes(body.image)) images.unshift(body.image);
  return [...new Set(images)].slice(0, 10);
}

// GET: All active products
router.get("/", async (req, res) => {
  try {
    const products = await Product.find({ isActive: true }).sort({ createdAt: -1 });
    res.json({ success: true, count: products.length, products });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch products" });
  }
});

// GET: Single active product
router.get("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }
    const product = await Product.findOne({ _id: req.params.id, isActive: true });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch product" });
  }
});

// POST: Create product
router.post("/", requireAdmin, async (req, res) => {
  try {
    const { name, slug, description, price, originalPrice, category, stock } = req.body;
    if (!name || !slug || price === undefined || !category) {
      return res.status(400).json({
        success: false,
        message: "Name, slug, price and category are required",
      });
    }

    const images = normalizeImages(req.body);
    const product = await Product.create({
      name, slug, description, price, originalPrice, category,
      image: images[0] || req.body.image || "",
      images,
      stock,
    });

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      product,
    });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 400).json({
      success: false,
      message: error.code === 11000 ? "This product slug already exists" : error.message,
    });
  }
});

// PATCH: Update product
router.patch("/:id", requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }

    const allowedFields = [
      "name", "slug", "description", "price", "originalPrice",
      "category", "image", "images", "stock", "isActive",
    ];
    const updates = {};
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "images")) {
      updates.images = normalizeImages(updates);
      if (!updates.image && updates.images.length) updates.image = updates.images[0];
    } else if (Object.prototype.hasOwnProperty.call(updates, "image")) {
      updates.images = updates.image ? [updates.image] : [];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one valid field to update",
      });
    }

    const previous = await Product.findById(req.params.id);
    if (!previous) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id, { $set: updates }, { new: true, runValidators: true }
    );

    // Remove old GridFS images no longer referenced by this product.
    if (Array.isArray(updates.images)) {
      const retained = new Set(updates.images);
      const oldImages = [...new Set([previous.image, ...(previous.images || [])].filter(Boolean))];
      for (const oldImage of oldImages) {
        if (!retained.has(oldImage)) await deleteGridFSImage(oldImage);
      }
    } else if (updates.image && updates.image !== previous.image) {
      await deleteGridFSImage(previous.image);
    }

    res.json({ success: true, message: "Product updated successfully", product });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 400).json({
      success: false,
      message: error.message,
    });
  }
});

// DELETE: Permanently delete product and its stored images
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    await Product.findByIdAndDelete(req.params.id);
    const allImages = [...new Set([product.image, ...(product.images || [])].filter(Boolean))];
    for (const imageUrl of allImages) await deleteGridFSImage(imageUrl);

    res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete product" });
  }
});

module.exports = router;
