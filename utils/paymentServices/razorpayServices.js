const Razorpay = require("razorpay");
const mongoose = require("mongoose");
const ObjectId = mongoose.Types.ObjectId;
const crypto = require("crypto");
const User = require("../../models/user");
const Cart = require("../../models/cartSchema");
const Order = require("../../models/orderSchema");
const Product = require("../../models/product");
const { finalizeOrder } = require("../orderUpdationUtils");
const errorHandler = require("../errorHandlerUtils");
const successHandler = require("../successHandlerUtils");
const HttpStatus = require("../httpStatus");

// Load Razorpay credentials from environment variables
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create Razorpay Order
const createRazorpayOrder = async (orderDetails, next) => {
  try {
    const razorpayOrder = await razorpay.orders.create(orderDetails);
    return razorpayOrder;
  } catch (err) {
    console.error("Error creating Razorpay order: ", err);
    return next(err);
  }
};

// Verify Razorpay Payment Signature
const verifyRazorpayPaymentSignature = (
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
) => {
  const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
  const data = `${razorpayOrderId}|${razorpayPaymentId}`;
  hmac.update(data);
  const generatedSignature = hmac.digest("hex");

  return generatedSignature === razorpaySignature;
};

// Confirm Razorpay Payment
const confirmRazorpayPayment = async (
  razorpayOrderId,
  razorpayPaymentId,
  userId,
  couponId,
) => {
  const order = await Order.findOne({ razorpayOrderId });
  if (!order) {
    throw new Error("Order not found.");
  }

  const orderItems = order.orderItems;
  order.orderPaymentStatus = "Success";
  order.orderStatus = "Pending";
  order.orderItems.forEach((item) => (item.itemStatus = "Pending"));
  order.razorpayPaymentId = razorpayPaymentId;

  await finalizeOrder(userId, order, couponId, orderItems);

  return order;
};

// Handle Razorpay Payment Failure
const handleRazorpayPaymentFailure = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findOne({ razorpayOrderId: orderId });
    if (!order) {
      return errorHandler(res, HttpStatus.NOT_FOUND, "Order not found.");
    }

    order.orderStatus = "Failed";
    order.orderPaymentStatus = "Failed";
    await Order.updateMany(
      { "orderItems._id": { $in: order.orderItems.map((item) => item._id) } },
      { $set: { "orderItems.$[].itemStatus": "Failed" } },
    );
    await order.save();

    return successHandler(
      res,
      HttpStatus.PAYMENT_REQUIRED,
      "Order payment failed. You can retry the payment from your order details page.",
    );
  } catch (err) {
    console.error("Error handling payment failure: ", err);
    return next(err);
  }
};

module.exports = {
  createRazorpayOrder,
  verifyRazorpayPaymentSignature,
  confirmRazorpayPayment,
  handleRazorpayPaymentFailure,
};