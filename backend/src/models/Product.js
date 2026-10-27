const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, min: 0 },
    category: { type: String, required: true, trim: true },
    // Legacy primary image is kept for existing frontend compatibility.
    image: { type: String, default: "" },
    // All product image URLs, with image as the primary image.
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (images) => images.length <= 10,
        message: "A product can have a maximum of 10 images.",
      },
    },
    stock: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.pre("validate", function (next) {
  if ((!this.images || this.images.length === 0) && this.image) {
    this.images = [this.image];
  } else if (this.images?.length && !this.image) {
    this.image = this.images[0];
  }
  next();
});

module.exports = mongoose.model("Product", productSchema);
