const mongoose = require('mongoose');
const { Schema, Types: { ObjectId } } = mongoose;

const reviewSchema = new Schema({
  orderId:         { type: ObjectId, ref: 'Order',      required: true, unique: true },
  orderCode:       { type: String,   required: true },
  userId:          { type: ObjectId, ref: 'User',       default: null },
  restaurantId:    { type: ObjectId, ref: 'Restaurant', required: true },
  foodRating:      { type: Number,   required: true, min: 1, max: 5 },
  deliveryRating:  { type: Number,   default: null,  min: 1, max: 5 },
  comment:         { type: String,   trim: true, maxlength: 300, default: '' },
  reviewerName:    { type: String,   trim: true, maxlength: 60,  default: 'Anonymous' }
}, { timestamps: true });

reviewSchema.index({ restaurantId: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
