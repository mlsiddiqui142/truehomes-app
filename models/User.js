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
    addresses: [
      {
        label: { type: String, default: 'Home' },
        address: { type: String, required: true, trim: true, maxlength: 200 }
      }
    ],
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['customer', 'admin', 'delivery_partner'], default: 'customer' },
    isApproved: { type: Boolean, default: false }
  },
  { timestamps: true }
);

userSchema.index({ role: 1, email: 1 });

module.exports = mongoose.model('User', userSchema);