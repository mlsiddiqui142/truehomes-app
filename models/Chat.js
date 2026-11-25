const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  senderRole: { type: String, enum: ['customer', 'delivery_partner', 'admin', 'kitchen_owner'], required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  senderName: { type: String, default: 'User' },
  text: { type: String, required: true, trim: true, maxlength: 500 },
  sentAt: { type: Date, default: Date.now }
});

const chatSchema = new mongoose.Schema(
  {
    orderCode: { type: String, required: true, index: true },
    messages: [chatMessageSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model('Chat', chatSchema);
