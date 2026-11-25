import React, { memo, useRef, useEffect } from "react";

/**
 * ChatModal – in-app live chat for an order.
 *
 * @param {Object}   props
 * @param {string}   props.orderCode       - The order code being chatted about
 * @param {Array}    props.messages        - Array of chat message objects
 * @param {string}   props.inputValue      - Controlled input value
 * @param {Function} props.onInputChange   - Input change handler
 * @param {Function} props.onSend         - Send message handler
 * @param {Function} props.onClose        - Close modal handler
 */
const ChatModal = memo(function ChatModal({
  orderCode, messages, inputValue, onInputChange, onSend, onClose,
}) {
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input on open; return focus on close
  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      // return focus to trigger button on close would be handled by parent
    };
  }, []);

  // Keyboard trap: Escape closes modal
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Live chat for order ${orderCode}`}
    >
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close chat">×</button>
        <h3>💬 Live Chat – Order {orderCode}</h3>

        <div
          className="chat-messages"
          style={{ maxHeight: 300, overflowY: "auto", marginBottom: 12 }}
          aria-live="polite"
          aria-label="Chat messages"
        >
          {messages.length === 0 && (
            <p className="muted" style={{ textAlign: "center", color: "#94a3b8" }}>
              No messages yet. Start the conversation!
            </p>
          )}
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`chat-bubble ${msg.sender === "me" ? "outgoing" : "incoming"}`}
              role="listitem"
            >
              <strong>{msg.sender}:</strong> {msg.message || msg.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); onSend(); }}
          style={{ display: "flex", gap: 8 }}
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a message…"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            aria-label="Chat message input"
            style={{ flex: 1 }}
          />
          <button type="submit" aria-label="Send message">Send</button>
        </form>
      </div>
    </div>
  );
});

export default ChatModal;
