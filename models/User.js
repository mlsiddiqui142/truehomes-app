const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 120,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address']
    },
    phone: { type: String, trim: true, match: [/^[0-9+\s-]{10,15}$/, 'Please provide a valid phone number'] },
    avatar: { type: String, default: '' },
    bio: { type: String, trim: true, maxlength: 160, default: '' },
    dietaryPreference: { type: String, enum: ['all', 'veg_only', 'non_veg', 'vegan'], default: 'all' },
    dateOfBirth: { type: String, default: '' },
    gender: { type: String, enum: ['prefer_not_to_say', 'female', 'male', 'other'], default: 'prefer_not_to_say' },
    addresses: [
      {
        label: { type: String, default: 'Home' },
        address: { type: String, required: true, trim: true, maxlength: 200 }
      }
    ],
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['customer', 'admin', 'delivery_partner', 'kitchen_owner'], default: 'customer' },
    isApproved: { type: Boolean, default: false },
    isAvailable: { type: Boolean, default: true },
    walletBalance: { type: Number, default: 0, min: 0 },
    referralCode: { type: String, sparse: true, default: null },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    pushSubscription: { type: Object, default: null }
  },
  { timestamps: true }
);

userSchema.index({ role: 1, email: 1 });

module.exports = mongoose.model('User', userSchema);