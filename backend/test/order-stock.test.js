process.env.JWT_SECRET = "isolated-test-secret-key-at-least-32-characters";

const mongoose = require("mongoose");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const Product = require("../src/models/Product");
const Order = require("../src/models/Order");
const orderRoutes = require("../src/routes/orderRoutes");

const app = express();
app.use(express.json());
app.use("/api/orders", orderRoutes);

const uri = "mongodb://127.0.0.1:27018/testdb?replicaSet=testRs";

let token;
let product;

beforeAll(async () => {
  await mongoose.connect(uri);
  token = jwt.sign(
    { role: "admin" },
    process.env.JWT_SECRET,
    {
      issuer: "your-divine-store",
      audience: "your-divine-store-admin",
      expiresIn: "10m"
    }
  );
});

beforeEach(async () => {
  await Order.deleteMany({});
  await Product.deleteMany({});

  product = await Product.create({
    name: "TEMPORARY TEST PENDANT",
    slug: "temporary-test-pendant",
    description: "Automated test product only",
    price: 299,
    originalPrice: 399,
    category: "Religious",
    image: "/images/test-pendant.png",
    images: ["/images/test-pendant.png"],
    stock: 10,
    isActive: true
  });
});

afterAll(async () => {
  await mongoose.disconnect();
});

test("order cancellation restores stock exactly once", async () => {
  const placed = await request(app)
    .post("/api/orders")
    .send({
      customer: {
        name: "Test Customer",
        phone: "9999999999"
      },
      shippingAddress: {
        address: "Test Address",
        city: "Test City",
        state: "Jharkhand",
        pincode: "825301"
      },
      items: [{ productId: product._id.toString(), quantity: 2 }]
    });

  console.log("ORDER CREATE RESPONSE:", placed.status, placed.body);

  expect(placed.status).toBe(201);

  const orderId =
    placed.body.order?._id ||
    placed.body.data?._id ||
    placed.body._id;

  expect(orderId).toBeTruthy();

  let savedProduct = await Product.findById(product._id);
  expect(savedProduct.stock).toBe(8);

  const headers = { Authorization: `Bearer ${token}` };

  const confirmed = await request(app)
    .patch(`/api/orders/${orderId}/status`)
    .set(headers)
    .send({ status: "Confirmed" });

  expect(confirmed.status).toBe(200);

  const cancelled = await request(app)
    .patch(`/api/orders/${orderId}/status`)
    .set(headers)
    .send({ status: "Cancelled" });

  expect(cancelled.status).toBe(200);

  savedProduct = await Product.findById(product._id);
  expect(savedProduct.stock).toBe(10);

  const savedOrder = await Order.findById(orderId);
  expect(savedOrder.status).toBe("Cancelled");
  expect(savedOrder.stockRestocked).toBe(true);

  const repeatedCancellation = await request(app)
    .patch(`/api/orders/${orderId}/status`)
    .set(headers)
    .send({ status: "Cancelled" });

  expect(repeatedCancellation.status).toBe(409);

  savedProduct = await Product.findById(product._id);
  expect(savedProduct.stock).toBe(10);
});

test("invalid status transition returns 409 without changing stock", async () => {
  const placed = await request(app)
    .post("/api/orders")
    .send({
      customer: {
        name: "Test Customer",
        phone: "9999999999"
      },
      shippingAddress: {
        address: "Test Address",
        city: "Test City",
        state: "Jharkhand",
        pincode: "825301"
      },
      items: [{ productId: product._id.toString(), quantity: 2 }]
    });

  expect(placed.status).toBe(201);

  const orderId =
    placed.body.order?._id ||
    placed.body.data?._id ||
    placed.body._id;

  expect(orderId).toBeTruthy();

  const result = await request(app)
    .patch(`/api/orders/${orderId}/status`)
    .set({ Authorization: `Bearer ${token}` })
    .send({ status: "Delivered" });

  expect(result.status).toBe(409);

  const savedProduct = await Product.findById(product._id);
  expect(savedProduct.stock).toBe(8);

  const savedOrder = await Order.findById(orderId);
  expect(savedOrder.status).toBe("Placed");
});


test("insufficient stock rejects order without changing stock", async () => {
  const response = await request(app)
    .post("/api/orders")
    .send({
      customer: {
        name: "Test Customer",
        phone: "9999999999"
      },
      shippingAddress: {
        address: "Test Address",
        city: "Test City",
        state: "Jharkhand",
        pincode: "825301"
      },
      items: [
        { productId: product._id.toString(), quantity: 11 }
      ]
    });

  expect(response.status).not.toBe(201);

  const savedProduct = await Product.findById(product._id);
  expect(savedProduct.stock).toBe(10);

  expect(await Order.countDocuments()).toBe(0);
});

test("concurrent cancellation restores stock only once", async () => {
  const placed = await request(app)
    .post("/api/orders")
    .send({
      customer: {
        name: "Test Customer",
        phone: "9999999999"
      },
      shippingAddress: {
        address: "Test Address",
        city: "Test City",
        state: "Jharkhand",
        pincode: "825301"
      },
      items: [
        { productId: product._id.toString(), quantity: 2 }
      ]
    });

  expect(placed.status).toBe(201);

  const orderId =
    placed.body.order?._id ||
    placed.body.data?._id ||
    placed.body._id;

  expect(orderId).toBeTruthy();

  const headers = { Authorization: `Bearer ${token}` };

  const confirmed = await request(app)
    .patch(`/api/orders/${orderId}/status`)
    .set(headers)
    .send({ status: "Confirmed" });

  expect(confirmed.status).toBe(200);

  const responses = await Promise.all([
    request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set(headers)
      .send({ status: "Cancelled" }),

    request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set(headers)
      .send({ status: "Cancelled" })
  ]);

  expect(responses.filter(r => r.status === 200)).toHaveLength(1);
  expect(responses.filter(r => r.status === 409)).toHaveLength(1);

  const savedProduct = await Product.findById(product._id);
  expect(savedProduct.stock).toBe(10);

  const savedOrder = await Order.findById(orderId);
  expect(savedOrder.status).toBe("Cancelled");
  expect(savedOrder.stockRestocked).toBe(true);
});

test("failed order transaction does not leave partial stock deduction", async () => {
  const originalStock = await Product.findById(product._id);
  expect(originalStock.stock).toBe(10);

  // Use two products: the first has stock, the second does not.
  const unavailableProduct = await Product.create({
    name: "Unavailable Test Pendant",
    slug: "unavailable-test-pendant",
    description: "Temporary rollback test product",
    price: 199,
    originalPrice: 249,
    category: "Religious",
    image: "/images/test-unavailable.png",
    images: ["/images/test-unavailable.png"],
    stock: 0,
    isActive: true
  });

  const response = await request(app)
    .post("/api/orders")
    .send({
      customer: {
        name: "Rollback Test",
        phone: "9999999999"
      },
      shippingAddress: {
        address: "Test Address",
        city: "Test City",
        state: "Jharkhand",
        pincode: "825301"
      },
      items: [
        { productId: product._id.toString(), quantity: 2 },
        { productId: unavailableProduct._id.toString(), quantity: 1 }
      ]
    });

  expect(response.status).not.toBe(201);

  const firstProductAfter = await Product.findById(product._id);
  const unavailableAfter = await Product.findById(unavailableProduct._id);

  expect(firstProductAfter.stock).toBe(10);
  expect(unavailableAfter.stock).toBe(0);
  expect(await Order.countDocuments()).toBe(0);
});

test("duplicate cart items are combined and stock is deducted correctly", async () => {
  const response = await request(app)
    .post("/api/orders")
    .send({
      customer: {
        name: "Duplicate Item Test",
        phone: "9999999999"
      },
      shippingAddress: {
        address: "Test Address",
        city: "Test City",
        state: "Jharkhand",
        pincode: "825301"
      },
      items: [
        { productId: product._id.toString(), quantity: 1 },
        { productId: product._id.toString(), quantity: 2 }
      ]
    });

  expect(response.status).toBe(201);

  const savedProduct = await Product.findById(product._id);
  expect(savedProduct.stock).toBe(7);

  const order = await Order.findOne({});
  expect(order).toBeTruthy();

  const matchingItems = order.items.filter(
    item => item.productId.toString() === product._id.toString()
  );

  expect(matchingItems).toHaveLength(1);
  expect(matchingItems[0].quantity).toBe(3);
});

test("invalid product ID is rejected without creating an order", async () => {
  const response = await request(app)
    .post("/api/orders")
    .send({
      customer: {
        name: "Invalid ID Test",
        phone: "9999999999"
      },
      shippingAddress: {
        address: "Test Address",
        city: "Test City",
        state: "Jharkhand",
        pincode: "825301"
      },
      items: [
        { productId: "not-a-valid-object-id", quantity: 1 }
      ]
    });

  expect(response.status).not.toBe(201);
  expect(await Order.countDocuments()).toBe(0);

  const savedProduct = await Product.findById(product._id);
  expect(savedProduct.stock).toBe(10);
});

test("inactive product cannot be ordered", async () => {
  await Product.findByIdAndUpdate(product._id, { isActive: false });

  const response = await request(app)
    .post("/api/orders")
    .send({
      customer: {
        name: "Inactive Product Test",
        phone: "9999999999"
      },
      shippingAddress: {
        address: "Test Address",
        city: "Test City",
        state: "Jharkhand",
        pincode: "825301"
      },
      items: [
        { productId: product._id.toString(), quantity: 1 }
      ]
    });

  expect(response.status).not.toBe(201);
  expect(await Order.countDocuments()).toBe(0);

  const savedProduct = await Product.findById(product._id);
  expect(savedProduct.stock).toBe(10);
});

test.each([
  ["zero", 0],
  ["negative", -1],
  ["over-limit", 1001],
  ["decimal", 1.5]
])("invalid quantity (%s) is rejected", async (_label, quantity) => {
  const response = await request(app)
    .post("/api/orders")
    .send({
      customer: {
        name: "Invalid Quantity Test",
        phone: "9999999999"
      },
      shippingAddress: {
        address: "Test Address",
        city: "Test City",
        state: "Jharkhand",
        pincode: "825301"
      },
      items: [
        { productId: product._id.toString(), quantity }
      ]
    });

  expect(response.status).not.toBe(201);
  expect(await Order.countDocuments()).toBe(0);

  const savedProduct = await Product.findById(product._id);
  expect(savedProduct.stock).toBe(10);
});

test("admin order list rejects requests without a token", async () => {
  const response = await request(app).get("/api/orders");

  expect(response.status).toBe(401);
});

test("order status update rejects requests without a token", async () => {
  const response = await request(app)
    .patch("/api/orders/507f1f77bcf86cd799439011/status")
    .send({ status: "Cancelled" });

  expect(response.status).toBe(401);
});

test("admin route rejects a token with the customer role", async () => {
  const customerToken = jwt.sign(
    { role: "customer" },
    process.env.JWT_SECRET,
    {
      issuer: "your-divine-store",
      audience: "your-divine-store-admin",
      expiresIn: "10m"
    }
  );

  const response = await request(app)
    .get("/api/orders")
    .set("Authorization", `Bearer ${customerToken}`);

  expect(response.status).toBe(403);
});

test("admin route rejects a token signed with the wrong secret", async () => {
  const invalidToken = jwt.sign(
    { role: "admin" },
    "wrong-secret-key-that-is-long-enough-for-testing",
    {
      issuer: "your-divine-store",
      audience: "your-divine-store-admin",
      expiresIn: "10m"
    }
  );

  const response = await request(app)
    .get("/api/orders")
    .set("Authorization", `Bearer ${invalidToken}`);

  expect(response.status).toBe(401);
});

test("status update rejects a malformed order ID", async () => {
  const response = await request(app)
    .patch("/api/orders/not-an-object-id/status")
    .set("Authorization", `Bearer ${token}`)
    .send({ status: "Cancelled" });

  expect(response.status).toBe(400);
});

test("client price and total tampering are ignored", async () => {
  const response = await request(app)
    .post("/api/orders")
    .send({
      customer: {
        name: "Price Tampering Test",
        phone: "9999999999"
      },
      shippingAddress: {
        address: "Test Address",
        city: "Test City",
        state: "Jharkhand",
        pincode: "825301"
      },
      items: [
        {
          productId: product._id.toString(),
          quantity: 2,
          price: 1,
          subtotal: 2
        }
      ],
      subtotal: 2,
      totalAmount: 2,
      shippingCharge: 0
    });

  expect(response.status).toBe(201);

  const order = await Order.findOne({});
  expect(order).toBeTruthy();
  expect(order.items).toHaveLength(1);
  expect(order.items[0].price).toBe(299);
  expect(order.items[0].quantity).toBe(2);
  expect(order.items[0].subtotal).toBe(598);
  expect(order.subtotal).toBe(598);
  expect(order.totalAmount).toBe(598);

  const savedProduct = await Product.findById(product._id);
  expect(savedProduct.stock).toBe(8);
});

test.each([
  ["missing customer name", { phone: "9999999999" }],
  ["empty customer name", { name: "   ", phone: "9999999999" }],
  ["missing customer phone", { name: "Validation Test" }],
  ["empty customer phone", { name: "Validation Test", phone: "   " }]
])("checkout rejects %s", async (_label, customer) => {
  const response = await request(app)
    .post("/api/orders")
    .send({
      customer,
      shippingAddress: {
        address: "Test Address",
        city: "Test City",
        state: "Jharkhand",
        pincode: "825301"
      },
      items: [
        { productId: product._id.toString(), quantity: 1 }
      ]
    });

  expect(response.status).toBe(400);
  expect(await Order.countDocuments()).toBe(0);

  const savedProduct = await Product.findById(product._id);
  expect(savedProduct.stock).toBe(10);
});

test("concurrent orders cannot oversell available stock", async () => {
  const makeOrder = () => request(app)
    .post("/api/orders")
    .send({
      customer: {
        name: "Concurrent Checkout Test",
        phone: "9999999999"
      },
      shippingAddress: {
        address: "Test Address",
        city: "Test City",
        state: "Jharkhand",
        pincode: "825301"
      },
      items: [
        { productId: product._id.toString(), quantity: 6 }
      ]
    });

  const responses = await Promise.all([
    makeOrder(),
    makeOrder()
  ]);

  expect(responses.filter(r => r.status === 201)).toHaveLength(1);
  expect(responses.filter(r => r.status === 409)).toHaveLength(1);

  const savedProduct = await Product.findById(product._id);
  expect(savedProduct.stock).toBe(4);
  expect(await Order.countDocuments()).toBe(1);
});
