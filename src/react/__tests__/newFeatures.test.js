// UI tests for the newly implemented features

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import App from "../main.jsx";

// Mock fetch for API calls used by the app
global.fetch = jest.fn((url, options) => {
  // Simple mock router based on URL
  if (url.includes("/api/user/wallet")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ balance: 1500 })
    });
  }
  if (url.includes("/api/push/subscribe")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }
  // Default mock response
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
});

describe("New Features UI", () => {
  beforeEach(() => {
    // Reset localStorage before each test
    localStorage.clear();
  });

  test("Kitchen Owner Portal modal appears for kitchen_owner role", async () => {
    // Render app with a mocked user role
    const mockUser = { role: "kitchen_owner", name: "Test Owner" };
    render(<App />);
    // Simulate login by setting token & user in localStorage (simplified)
    localStorage.setItem("truehomes_token", "dummy-token");
    // Force user state via direct assignment (requires exposing a setter – assume app reads from token)
    // Click the portal button (id assumed from implementation)
    const portalBtn = await screen.findByText(/Kitchen Partner Portal/i);
    fireEvent.click(portalBtn);
    // Modal should appear
    const modalHeader = await screen.findByText(/Kitchen Dashboard/i);
    expect(modalHeader).toBeInTheDocument();
  });

  test("Chat modal opens from order in kitchen portal", async () => {
    render(<App />);
    // Open portal first
    const portalBtn = await screen.findByText(/Kitchen Partner Portal/i);
    fireEvent.click(portalBtn);
    // Assume an order item has a "Chat" button with label "Chat"
    const chatBtn = await screen.findByRole("button", { name: /Chat/i });
    fireEvent.click(chatBtn);
    const chatHeader = await screen.findByText(/Live Chat/i);
    expect(chatHeader).toBeInTheDocument();
  });

  test("Push prompt banner shows when permission default and persists flag", async () => {
    // Mock Notification permission
    Object.defineProperty(global, "Notification", {
      value: { permission: "default", requestPermission: jest.fn(() => Promise.resolve("granted")) },
      writable: true
    });
    render(<App />);
    const enableBtn = await screen.findByRole("button", { name: /Enable Push/i });
    fireEvent.click(enableBtn);
    await waitFor(() => {
      expect(localStorage.getItem("truehomes_push_subscribed")).toBe("true");
    });
  });

  test("Wallet balance displayed and wallet‑deduction checkbox works", async () => {
    render(<App />);
    // Simulate logged‑in customer
    localStorage.setItem("truehomes_token", "dummy-token");
    // Wait for wallet fetch to resolve and UI to update
    const balanceElem = await screen.findByText(/Wallet Balance:/i);
    expect(balanceElem).toHaveTextContent("1500");
    // Checkout checkbox
    const checkbox = await screen.findByLabelText(/Use Wallet Balance/i);
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});
