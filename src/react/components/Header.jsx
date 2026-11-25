import React, { useState } from 'react';
import './Header.css';

const Header = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleMenu = () => setMobileOpen(!mobileOpen);

  return (
    <header className="truehomes-header">
      <div className="header-container">
        {/* Logo */}
        <div className="header-logo">
          <a href="/" className="logo-link">
            <span className="logo-text">TRUEHOMES</span>
          </a>
        </div>
        {/* Navigation */}
        <nav className={`header-nav ${mobileOpen ? 'active' : ''}`}>
          <ul>
            <li><a href="#home">Home</a></li>
            <li><a href="#restaurants">Restaurants</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#contact">Contact</a></li>
          </ul>
        </nav>
        {/* Actions */}
        <div className="header-actions">
          <button className="action-btn search-btn" aria-label="Search">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <button className="action-btn cart-btn" aria-label="Cart">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            <span className="cart-count">0</span>
          </button>
          <a href="#contact" className="cta-button">Let's Work</a>
          {/* Mobile hamburger */}
          <button className="mobile-menu-toggle" onClick={toggleMenu} aria-label="Toggle menu">
            <span className={`hamburger-bar ${mobileOpen ? 'open' : ''}`}></span>
            <span className={`hamburger-bar ${mobileOpen ? 'open' : ''}`}></span>
            <span className={`hamburger-bar ${mobileOpen ? 'open' : ''}`}></span>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
