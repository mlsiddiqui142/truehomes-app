const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    orderCode: { type: String, unique: true, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    customerName: { type: String, required: true, trim: true, maxlength: 60 },
    customerPhone: { type: String, required: true, match: /^[0-9+\s-]{10,15}$/ },
    deliveryAddress: { type: String, required: true, trim: true, maxlength: 200 },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    restaurantName: String,
    items: [
      {
        menuItemId: mongoose.Schema.Types.ObjectId,
        name: String,
        qty: { type: Number, min: 1, max: 20 },
        unitPrice: Number
      }
    ],
    itemTotal: Number,
    deliveryFee: Number,
    tax: Number,
    discount: Number,
    tip: { type: Number, default: 0, min: 0, max: 500 },
    grandTotal: Number,
    paymentMethod: { type: String, enum: ['UPI', 'CARD', 'RAZORPAY', 'COD'], default: 'RAZORPAY' },
    paymentStatus: { type: String, enum: ['PENDING', 'PAID', 'COD'], default: 'PENDING' },
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    assignedPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedPartnerName: { type: String, default: null },
    status: {
      type: String,
      enum: ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'],
      default: 'CONFIRMED'
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);