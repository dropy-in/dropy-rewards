(function () {
  "use strict";

  var root = document.getElementById("dropy-exit-root");
  if (!root) return;

  // ─── Helpers ───
  function xhr(url, cb) {
    var x = new XMLHttpRequest();
    x.open("GET", url, true);
    x.onload = function () {
      try { cb(null, JSON.parse(x.responseText)); } catch (e) { cb(e, null); }
    };
    x.onerror = function () { cb(new Error("network"), null); };
    x.send();
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function setCookie(name, val, days) {
    var d = new Date();
    d.setTime(d.getTime() + days * 86400000);
    document.cookie = name + "=" + encodeURIComponent(val) +
      ";expires=" + d.toUTCString() + ";path=/;SameSite=Lax";
  }

  function getCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function isMobile() {
    return window.innerWidth < 768;
  }

  function isCartPage() {
    var p = window.location.pathname;
    return p === "/cart" || p.indexOf("/cart") === 0;
  }

  function isCheckoutPage() {
    return window.location.pathname.indexOf("/checkouts/") !== -1 ||
           window.location.pathname.indexOf("/checkout") !== -1;
  }

  // ─── Fetch config + cart in parallel ───
  var cfg = null;
  var cart = null;
  var ready = 0;

  function onReady() {
    ready++;
    if (ready < 2) return;
    if (!cfg) return;
    if (cfg.popup && cfg.popup.enabled) initPopup();
    if (cfg.timer && cfg.timer.enabled) initTimer();
  }

  xhr("/apps/rewards/exit/config", function (err, data) {
    if (!err && data) cfg = data;
    onReady();
  });

  xhr("/cart.js", function (err, data) {
    if (!err && data) cart = data;
    onReady();
  });


  // ═══════════════════════════════════════
  //  EXIT INTENT POPUP
  // ═══════════════════════════════════════
  function initPopup() {
    var p = cfg.popup;
    if (isCheckoutPage()) return;

    // ── Anti-annoyance checks ──

    // 1. Already shown this session
    if (sessionStorage.getItem("dei_shown")) return;

    // 2. Cooldown between shows (cross-session)
    var lastShown = getCookie("dei_last");
    if (lastShown) {
      var elapsed = (Date.now() - parseInt(lastShown, 10)) / 3600000;
      if (elapsed < (p.cooldown_hours || 72)) return;
    }

    // 3. Dismissed recently
    if (getCookie("dei_dismissed")) return;

    // 4. Converted (just bought)
    if (getCookie("dei_converted")) return;

    // 5. Max lifetime shows reached
    var showCount = parseInt(getCookie("dei_count") || "0", 10);
    if (showCount >= (p.max_lifetime || 3)) return;

    // 6. Page view count
    var pageViews = parseInt(sessionStorage.getItem("dei_pages") || "0", 10) + 1;
    sessionStorage.setItem("dei_pages", String(pageViews));
    if (pageViews < (p.min_pages || 2)) return;

    // 7. Cart must have items
    if (!cart || !cart.item_count || cart.item_count < 1) return;

    // ── Set thank-you page cookie (for conversion tracking) ──
    if (window.location.pathname.indexOf("/thank_you") !== -1 ||
        window.location.pathname.indexOf("/thank-you") !== -1 ||
        window.location.pathname.indexOf("/orders/") !== -1) {
      setCookie("dei_converted", "1", 30);
      return;
    }

    // ── Build popup DOM ──
    var tier = (Array.isArray(p.tiers) && p.tiers[showCount]) ? p.tiers[showCount] : p.tiers[0];
    if (!tier) return;

    var overlay = document.createElement("div");
    overlay.className = "dei-overlay";

    var popup = document.createElement("div");
    popup.className = "dei-popup";

    var cartTotal = cart.total_price ? "₹" + (cart.total_price / 100).toLocaleString("en-IN") : "";

    var html = '<div class="dei-handle"></div>' +
      '<button class="dei-close" aria-label="Close">&times;</button>' +
      '<h2 class="dei-heading">' + esc(tier.heading) + '</h2>' +
      '<p class="dei-body">' + esc(tier.body) + '</p>';

    // Gift reminder
    if (p.show_gift_reminder && p.gift_reminder_text) {
      html += '<div class="dei-gift">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 7h-2.2c.13-.31.2-.65.2-1a3 3 0 0 0-5.2-2.05L12 4.9l-.8-.95A3 3 0 0 0 6 6c0 .35.07.69.2 1H4a2 2 0 0 0-2 2v2h20V9a2 2 0 0 0-2-2Zm-9-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm6 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM3 13v6a2 2 0 0 0 2 2h6v-8H3Zm10 8h6a2 2 0 0 0 2-2v-6h-8v8Z"/></svg>' +
        '<span>' + esc(p.gift_reminder_text) + '</span>' +
        '</div>';
    }

    // Discount code
    if (tier.discount) {
      html += '<div class="dei-discount">' +
        '<span>Use code </span>' +
        '<span class="dei-discount-code">' + esc(tier.discount) + '</span>' +
        '</div>';
    }

    // Cart total
    if (cartTotal) {
      html += '<p class="dei-cart-total">Cart total: <strong>' + cartTotal + '</strong> (' + cart.item_count + ' item' + (cart.item_count > 1 ? 's' : '') + ')</p>';
    }

    // CTA
    html += '<a class="dei-cta" href="/checkout">' + esc(p.cta_text || "Complete My Order") + '</a>';
    html += '<button class="dei-secondary">Continue Shopping</button>';

    popup.innerHTML = html;

    document.body.appendChild(overlay);
    document.body.appendChild(popup);

    // ── Show / Hide logic ──
    var shown = false;

    function showPopup() {
      if (shown) return;
      shown = true;

      // Record show
      sessionStorage.setItem("dei_shown", "1");
      setCookie("dei_last", String(Date.now()), 90);
      setCookie("dei_count", String(showCount + 1), 365);

      // Animate in
      requestAnimationFrame(function () {
        overlay.classList.add("dei-show");
        popup.classList.add("dei-show");
      });
    }

    function hidePopup(wasDismiss) {
      overlay.classList.remove("dei-show");
      popup.classList.remove("dei-show");
      teardown();

      if (wasDismiss) {
        setCookie("dei_dismissed", "1", p.dismiss_days || 7);
      }
    }

    // Close handlers
    popup.querySelector(".dei-close").addEventListener("click", function () { hidePopup(true); });
    popup.querySelector(".dei-secondary").addEventListener("click", function () { hidePopup(false); });
    overlay.addEventListener("click", function () { hidePopup(true); });

    // ── Triggers ──
    var idleTimer = null;
    var pageTimer = null;
    var minSecondsMet = false;

    // Wait min_seconds before arming triggers
    pageTimer = setTimeout(function () {
      minSecondsMet = true;
      armTriggers();
    }, (p.min_seconds || 30) * 1000);

    function armTriggers() {
      if (!minSecondsMet) return;

      // Desktop: mouseleave from viewport top
      if (!isMobile()) {
        document.addEventListener("mouseleave", onMouseLeave);
      }

      // Mobile + Desktop: idle timer
      startIdleTimer();

      // Both: tab switch / app switch
      document.addEventListener("visibilitychange", onVisChange);
    }

    function onMouseLeave(e) {
      if (e.clientY <= 0) {
        showPopup();
      }
    }

    function onVisChange() {
      if (document.hidden && minSecondsMet) {
        showPopup();
      }
    }

    function startIdleTimer() {
      clearIdleTimer();
      var timeout = isMobile() ? (p.idle_mobile || 20) : (p.idle_desktop || 30);
      idleTimer = setTimeout(function () {
        showPopup();
      }, timeout * 1000);
    }

    function clearIdleTimer() {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    }

    // Reset idle timer on user interaction
    var EVENTS = ["mousemove", "touchstart", "scroll", "keydown", "click"];
    function onActivity() {
      if (minSecondsMet && !shown) {
        startIdleTimer();
      }
    }
    EVENTS.forEach(function (e) { document.addEventListener(e, onActivity, { passive: true }); });

    function teardown() {
      clearIdleTimer();
      if (pageTimer) clearTimeout(pageTimer);
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("visibilitychange", onVisChange);
      EVENTS.forEach(function (e) { document.removeEventListener(e, onActivity); });
    }
  }


  // ═══════════════════════════════════════
  //  CART RESERVED TIMER
  // ═══════════════════════════════════════
  function initTimer() {
    var t = cfg.timer;
    if (!cart || !cart.item_count || cart.item_count < 1) return;
    if (isCheckoutPage()) return;

    // Only show on cart-related contexts
    // Inject into: cart page, and any cart drawer that has a known container
    var containers = [];

    // Cart page: look for common cart form containers
    if (isCartPage()) {
      var cartForm = document.querySelector("form[action='/cart']") ||
                     document.querySelector(".cart") ||
                     document.querySelector("[data-cart]") ||
                     document.querySelector("#cart") ||
                     document.querySelector("#MainContent");
      if (cartForm) containers.push(cartForm);
    }

    // Cart drawer: look for common drawer selectors (Maximize theme + common patterns)
    var drawerSelectors = [
      ".cart-drawer__body",
      ".cart-drawer__inner",
      "[data-cart-drawer]",
      "#cart-drawer",
      ".drawer__inner",
      ".js-drawer__inner",
      ".side-cart__body",
      ".ajaxcart__body"
    ];
    drawerSelectors.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) containers.push(el);
    });

    if (!containers.length) {
      // Fallback: try to inject after first found cart total/subtotal element
      var subtotal = document.querySelector(".cart__subtotal, .cart-subtotal, [data-cart-subtotal]");
      if (subtotal && subtotal.parentElement) containers.push(subtotal.parentElement);
    }

    if (!containers.length) return;

    // Timer state
    var duration = t.duration_seconds || 900;
    var storageKey = "dei_timer_start";
    var startTime = parseInt(sessionStorage.getItem(storageKey) || "0", 10);

    if (!startTime) {
      startTime = Math.floor(Date.now() / 1000);
      sessionStorage.setItem(storageKey, String(startTime));
    }

    var expired = false;
    var timerEls = [];

    // Build timer bar for each container
    containers.forEach(function (container) {
      var bar = document.createElement("div");
      bar.className = "dei-timer-bar";
      bar.innerHTML =
        '<span class="dei-timer-icon">🔒</span>' +
        '<span class="dei-timer-label">' + esc(t.label || "Items reserved for you") + '</span>' +
        '<span class="dei-timer-countdown">--:--</span>' +
        '<div class="dei-timer-progress"><div class="dei-timer-progress-fill" style="width:100%"></div></div>';

      // Insert at top of container
      if (container.firstChild) {
        container.insertBefore(bar, container.firstChild);
      } else {
        container.appendChild(bar);
      }
      timerEls.push(bar);
    });

    // Tick every second
    function tick() {
      var now = Math.floor(Date.now() / 1000);
      var elapsed = now - startTime;
      var remaining = Math.max(0, duration - elapsed);

      if (remaining <= 0 && !expired) {
        expired = true;
        showExpired();
        return;
      }

      if (expired) return;

      var mins = Math.floor(remaining / 60);
      var secs = remaining % 60;
      var display = mins + ":" + (secs < 10 ? "0" : "") + secs;
      var pct = (remaining / duration) * 100;

      timerEls.forEach(function (bar) {
        var countdown = bar.querySelector(".dei-timer-countdown");
        var fill = bar.querySelector(".dei-timer-progress-fill");
        if (countdown) countdown.textContent = display;
        if (fill) fill.style.width = pct + "%";
      });
    }

    function showExpired() {
      timerEls.forEach(function (bar) {
        var expiredEl = document.createElement("div");
        expiredEl.className = "dei-timer-expired";
        expiredEl.innerHTML =
          '<span class="dei-timer-expired-text">' + esc(t.expiry_message || "High demand — items may sell out!") + '</span>' +
          '<a class="dei-timer-expired-cta" href="/checkout">' + esc(t.expiry_cta || "Checkout Now") + '</a>';
        bar.parentNode.replaceChild(expiredEl, bar);
      });

      // Silent reset: on any interaction, restart timer after a delay
      function onInteract() {
        document.removeEventListener("click", onInteract);
        document.removeEventListener("touchstart", onInteract);
        setTimeout(function () {
          startTime = Math.floor(Date.now() / 1000);
          sessionStorage.setItem(storageKey, String(startTime));
          expired = false;
          // Reinit on next page nav (SPA) or reload
        }, 3000);
      }
      document.addEventListener("click", onInteract, { passive: true, once: true });
      document.addEventListener("touchstart", onInteract, { passive: true, once: true });
    }

    // Reset timer on add-to-cart (means they're still shopping)
    function watchCartChanges() {
      // Listen for Shopify's cart change event
      document.addEventListener("cart:change", resetTimer);
      // Also intercept XHR to /cart/add
      var origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        if (typeof url === "string" && url.indexOf("/cart/add") !== -1) {
          this.addEventListener("load", function () {
            resetTimer();
          });
        }
        return origOpen.apply(this, arguments);
      };
    }

    function resetTimer() {
      startTime = Math.floor(Date.now() / 1000);
      sessionStorage.setItem(storageKey, String(startTime));
      expired = false;
    }

    watchCartChanges();
    tick();
    setInterval(tick, 1000);
  }


  // ─── Thank-you page: set converted cookie ───
  if (window.location.pathname.indexOf("/thank_you") !== -1 ||
      window.location.pathname.indexOf("/thank-you") !== -1) {
    setCookie("dei_converted", "1", 30);
    // Clear timer
    sessionStorage.removeItem("dei_timer_start");
  }

})();
