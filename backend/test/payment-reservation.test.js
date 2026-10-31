
const mongoose = require("mongoose");

const Order = require("../src/models/Order");
const Product = require("../src/models/Product");
const {
  releaseExpiredReservations,
} = require("../src/services/paymentReservationService");

const uri =
  "mongodb://127.0.0.1:27017/your_divine_store_test?replicaSet=rs0";

let product;

async function createReservation(overrides = {}) {
  return Order.create({
    orderNumber: `YDS-RES-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    customer: {
      name: "Reservation Test",
      phone: "9999999999",
      email: "",
    },
    shippingAddress: {
      address: "Test Address",
      city: "Test City",
      state: "Jharkhand",
      pincode: "825301",
      country: "India",
    },
    items: [
      {
        productId: product._id,
        name: product.name,
        image: product.image || "",
        price: 299,
        quantity: 2,
        subtotal: 598,
      },
    ],
    subtotal: 598,
    shippingCharge: 0,
    totalAmount: 598,
    paymentMethod: "Razorpay",
    paymentStatus: "Pending",
    razorpayOrderId: `order_test_${Math.random()
      .toString(36)
      .slice(2, 10)}`,
    status: "Placed",
    stockReserved: true,
    stockRestocked: false,
    reservationExpiresAt: new Date(Date.now() - 60_000),
    ...overrides,
  });
}

beforeAll(async () => {
  await mongoose.connect(uri);
});

beforeEach(async () => {
  await Order.deleteMany({});
  await Product.deleteMany({});

  product = await Product.create({
    name: "Reservation Test Pendant",
    slug: "reservation-test-pendant",
    description: "Automated reservation test product",
    price: 299,
    originalPrice: 399,
    category: "Religious",
    image: "/images/test-pendant.png",
    images: ["/images/test-pendant.png"],
    stock: 8,
    isActive: true,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
});

test("expired reservation restores stock and cancels order", async () => {
  const order = await createReservation();

  const released = await releaseExpiredReservations();

  expect(released).toBe(1);

  const savedProduct = await Product.findById(product._id);
  const savedOrder = await Order.findById(order._id);

  expect(savedProduct.stock).toBe(10);
  expect(savedOrder.status).toBe("Cancelled");
  expect(savedOrder.stockReserved).toBe(false);
  expect(savedOrder.stockRestocked).toBe(true);
});

test("running cleanup twice does not restore stock twice", async () => {
  await createReservation();

  expect(await releaseExpiredReservations()).toBe(1);
  expect(await releaseExpiredReservations()).toBe(0);

  const savedProduct = await Product.findById(product._id);

  expect(savedProduct.stock).toBe(10);
});

test("unexpired reservation is not released", async () => {
  await createReservation({
    reservationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  const released = await releaseExpiredReservations();

  expect(released).toBe(0);

  const savedProduct = await Product.findById(product._id);
  const savedOrder = await Order.findOne({});

  expect(savedProduct.stock).toBe(8);
  expect(savedOrder.status).toBe("Placed");
  expect(savedOrder.stockReserved).toBe(true);
  expect(savedOrder.stockRestocked).toBe(false);
});

test("paid order is not released", async () => {
  await createReservation({
    paymentStatus: "Paid",
    razorpayPaymentId: "pay_test_paid",
  });

  const released = await releaseExpiredReservations();

  expect(released).toBe(0);

  const savedProduct = await Product.findById(product._id);
  const savedOrder = await Order.findOne({});

  expect(savedProduct.stock).toBe(8);
  expect(savedOrder.paymentStatus).toBe("Paid");
  expect(savedOrder.stockRestocked).toBe(false);
});

test("already cancelled order is not released twice", async () => {
  await createReservation({
    status: "Cancelled",
    stockReserved: false,
    stockRestocked: true,
  });

  const released = await releaseExpiredReservations();

  expect(released).toBe(0);

  const savedProduct = await Product.findById(product._id);

  expect(savedProduct.stock).toBe(8);
});

test("multiple expired reservations are all released", async () => {
  await createReservation();
  await createReservation();

  const released = await releaseExpiredReservations();

  expect(released).toBe(2);

  const savedProduct = await Product.findById(product._id);
  const savedOrders = await Order.find({});

  expect(savedProduct.stock).toBe(12);
  expect(savedOrders).toHaveLength(2);

  for (const order of savedOrders) {
    expect(order.status).toBe("Cancelled");
    expect(order.stockReserved).toBe(false);
    expect(order.stockRestocked).toBe(true);
  }
});

test("concurrent cleanup restores stock only once", async () => {
  await createReservation();

  const results = await Promise.all([
    releaseExpiredReservations(),
    releaseExpiredReservations(),
  ]);

  expect(results.reduce((total, count) => total + count, 0)).toBe(1);

  const savedProduct = await Product.findById(product._id);
  const savedOrder = await Order.findOne({});

  expect(savedProduct.stock).toBe(10);
  expect(savedOrder.status).toBe("Cancelled");
  expect(savedOrder.stockReserved).toBe(false);
  expect(savedOrder.stockRestocked).toBe(true);
});