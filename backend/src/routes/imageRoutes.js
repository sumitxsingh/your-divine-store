
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const sharp = require("sharp");
const requireAdmin = require("../middleware/authMiddleware");

const router = express.Router();

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGES = 10;
const IMAGE_SIZE = 1000;

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_IMAGES },
  fileFilter: (req, file, callback) => {
    if (!allowedTypes.has(file.mimetype)) {
      return callback(
        new Error("Only JPG, PNG, WEBP and GIF images are allowed.")
      );
    }
    callback(null, true);
  },
});

function getBucket() {
  if (!mongoose.connection.db) {
    throw new Error("MongoDB is not connected.");
  }

  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: "productImages",
  });
}

// POST /api/images/upload
router.post("/upload", requireAdmin, (req, res) => {
  upload.fields([
    { name: "images", maxCount: MAX_IMAGES },
    { name: "image", maxCount: 1 },
  ])(req, res, async (uploadError) => {
    if (uploadError) {
      const status =
        uploadError instanceof multer.MulterError
          ? uploadError.code === "LIMIT_FILE_SIZE"
            ? 413
            : 400
          : 400;

      return res.status(status).json({
        success: false,
        message:
          uploadError.code === "LIMIT_FILE_SIZE"
            ? "Each image must be 5 MB or less."
            : uploadError.message,
      });
    }

    const files = [
      ...(req.files?.images || []),
      ...(req.files?.image || []),
    ];

    if (!files.length) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one image to upload.",
      });
    }

    if (files.length > MAX_IMAGES) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_IMAGES} images are allowed per product.`,
      });
    }

    let bucket;

    try {
      bucket = getBucket();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Image storage is unavailable.",
      });
    }

    const uploaded = [];

    try {
      for (const file of files) {
        // Reject animated GIFs instead of silently removing animation.
        const metadata = await sharp(file.buffer, {
          animated: true,
          limitInputPixels: 40000000,
        }).metadata();

        if (metadata.format === "gif" && (metadata.pages || 1) > 1) {
          return res.status(400).json({
            success: false,
            message:
              "Animated GIFs are not supported. Please upload a JPG, PNG or WebP product image.",
          });
        }

        // Fit the complete product inside a square without stretching
        // or cutting off its edges. White space fills unused areas.
        const processedImage = await sharp(file.buffer, {
          limitInputPixels: 40000000,
        })
          .rotate()
          .flatten({ background: "#ffffff" })
          .resize(IMAGE_SIZE, IMAGE_SIZE, {
            fit: "contain",
            background: "#ffffff",
            withoutEnlargement: false,
          })
          .webp({ quality: 82, effort: 4 })
          .toBuffer();

        const stream = bucket.openUploadStream(
          `${file.originalname.replace(/\.[^.]+$/, "")}.webp`,
          {
            contentType: "image/webp",
            metadata: {
              uploadedAt: new Date(),
              originalName: file.originalname,
              originalType: file.mimetype,
              width: IMAGE_SIZE,
              height: IMAGE_SIZE,
              format: "webp",
            },
          }
        );

        await new Promise((resolve, reject) => {
          stream.once("error", reject);
          stream.once("finish", resolve);
          stream.end(processedImage);
        });

        const imageUrl =
          `${process.env.BACKEND_URL || "https://your-divine-store.onrender.com"}/api/images/${stream.id}`;

        uploaded.push({
          image: imageUrl,
          imageId: String(stream.id),
          filename: file.originalname,
        });
      }

      return res.status(201).json({
        success: true,
        message: "Images optimized and uploaded successfully.",
        images: uploaded,
        image: uploaded[0].image,
        imageId: uploaded[0].imageId,
      });
    } catch (error) {
      console.error("Image processing/upload failed:", error.message);

      await Promise.all(
        uploaded.map(async (item) => {
          try {
            await bucket.delete(
              new mongoose.Types.ObjectId(item.imageId)
            );
          } catch (cleanupError) {
            console.error(
              "Partial image cleanup failed:",
              cleanupError.message
            );
          }
        })
      );

      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: "Image processing or upload failed.",
        });
      }
    }
  });
});

// GET /api/images/:id
router.get("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid image ID.",
      });
    }

    const bucket = getBucket();
    const imageId = new mongoose.Types.ObjectId(req.params.id);

    const files = await mongoose.connection.db
      .collection("productImages.files")
      .find({ _id: imageId })
      .limit(1)
      .toArray();

    if (!files.length) {
      return res.status(404).json({
        success: false,
        message: "Image not found.",
      });
    }

    const file = files[0];

    res.set("Content-Type", file.contentType || "application/octet-stream");
    res.set("Cache-Control", "public, max-age=86400");
    res.set("X-Content-Type-Options", "nosniff");

    const downloadStream = bucket.openDownloadStream(imageId);

    downloadStream.on("error", (error) => {
      console.error("Image read error:", error.message);

      if (!res.headersSent) {
        res.status(404).end();
      } else {
        res.destroy(error);
      }
    });

    downloadStream.pipe(res);
  } catch (error) {
    console.error("Image retrieval error:", error.message);

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Unable to retrieve image.",
      });
    }
  }
});

module.exports = router;
