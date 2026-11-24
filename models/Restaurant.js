const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  category: String,
  isVeg: { type: Boolean, default: true },
  isBestseller: { type: Boolean, default: false },
  description: String,
  image: String
});

const restaurantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  cuisines: [String],
  rating: { type: Number, default: 4.2, min: 1, max: 5 },
  reviewCount: { type: Number, default: 0 },
  deliveryTime: { type: Number, default: 30 },
  costForTwo: { type: Number, default: 350 },
  isPureVeg: { type: Boolean, default: false },
  offerText: String,
  location: String,
  image: String,
  fssai: String,
  menu: [menuItemSchema]
});

restaurantSchema.index({ name: 1 });
restaurantSchema.index({ cuisines: 1 });
restaurantSchema.index({ isPureVeg: 1, deliveryTime: 1, rating: -1 });
restaurantSchema.index({ name: 'text', cuisines: 'text', 'menu.name': 'text' });

module.exports = mongoose.model('Restaurant', restaurantSchema);