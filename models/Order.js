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
    razorpayReceipt: { type: String, default: null },
    paymentVerifiedAt: { type: Date, default: null },
    assignedPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedPartnerName: { type: String, default: null },
    deliveryLocation: {
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
      updatedAt: { type: Date }
    },
    status: {
      type: String,
      enum: ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'],
      default: 'CONFIRMED'
    }
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, status: 1, createdAt: -1 });
orderSchema.index({ assignedPartnerId: 1, status: 1, createdAt: -1 });
orderSchema.index({ razorpayOrderId: 1 });
orderSchema.index({ razorpayPaymentId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Order', orderSchema);