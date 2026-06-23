(function () {
  var root = document.getElementById("dropy-rewards-root");
  if (!root) return;
  var d = root.dataset;
  var C = d.themeColor || "#FB923C";
  var pos = d.position === "left" ? "left" : "right";

  function xhr(method, url, body, cb) {
    var x = new XMLHttpRequest();
    x.open(method, url, true);
    x.onload = function () {
      var json = null;
      try { json = JSON.parse(x.responseText); } catch (e) {}
      cb(x.status >= 200 && x.status < 300 ? null : new Error("HTTP " + x.status), json);
    };
    x.onerror = function () { cb(new Error("network"), null); };
    if (body) {
      x.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
      x.send(body);
    } else x.send();
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  var ICON =
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 7h-2.2c.13-.31.2-.65.2-1a3 3 0 0 0-5.2-2.05L12 4.9l-.8-.95A3 3 0 0 0 6 6c0 .35.07.69.2 1H4a2 2 0 0 0-2 2v2h20V9a2 2 0 0 0-2-2Zm-9-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm6 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM3 13v6a2 2 0 0 0 2 2h6v-8H3Zm10 8h6a2 2 0 0 0 2-2v-6h-8v8Z"/></svg>';

  var door = document.createElement("button");
  door.className = "dr-door dr-" + pos;
  door.style.setProperty("--dr-c", C);
  var style = d.doorStyle || "icon_text";
  door.innerHTML =
    (style !== "text" ? ICON : "") +
    (style !== "icon" ? "<span>" + esc(d.doorText || "Rewards") + "</span>" : "");
  if (style === "icon") door.classList.add("dr-icon");
  document.body.appendChild(door);

  var panel = document.createElement("div");
  panel.className = "dr-panel dr-" + pos;
  panel.style.setProperty("--dr-c", C);
  panel.innerHTML =
    '<div class="dr-head"><span class="dr-orb1"></span><span class="dr-orb2"></span>' +
    '<div class="dr-welcome">' + esc(d.welcome || "Welcome") + "</div>" +
    '<div class="dr-name">' + esc(d.customerName || "") + "</div>" +
    '<button class="dr-x" aria-label="Close">&times;</button></div>' +
    '<div class="dr-body"><div class="dr-card">Loading…</div></div>';
  document.body.appendChild(panel);

  var offD = parseInt(d.offsetDesktop || "20", 10) || 20;
  var offM = parseInt(d.offsetMobile || "88", 10) || 88;
  [door, panel].forEach(function (el) {
    el.style.setProperty("--dr-off", offD + "px");
    el.style.setProperty("--dr-off-m", offM + "px");
  });

  var open = false;
  function toggle(v) {
    open = v;
    panel.classList.toggle("dr-open", open);
    if (open && !panel.dataset.loaded) load();
  }
  door.addEventListener("click", function () { toggle(!open); });
  panel.querySelector(".dr-x").addEventListener("click", function () { toggle(false); });

  function tierHTML(res) {
    var t = res.tier;
    if (!t || !t.name) return "";
    var h = '<div style="margin-top:10px"><span class="dr-pend">👑 ' + esc(t.name) +
      (t.multiplier > 1 ? " · " + t.multiplier + "× points" : "") + "</span></div>";
    if (t.next) {
      var pct = Math.min(100, Math.round((t.spend / t.next.entry) * 100));
      h += '<div class="dr-prog-row"><span>₹' + Math.ceil(t.next.toGo) + " spend to " + esc(t.next.name) +
        "</span><span>" + pct + '%</span></div><div class="dr-track"><div class="dr-fill" style="width:' + pct + '%"></div></div>';
    }
    return h;
  }

  function nextRewardHTML(res) {
    if (!res.loggedIn || !res.programs.length) return "";
    var avail = res.balance.available;
    var sorted = res.programs.slice().sort(function (a, b) { return a.points - b.points; });
    var next = null;
    for (var i = 0; i < sorted.length; i++) if (sorted[i].points > avail) { next = sorted[i]; break; }
    if (!next) {
      return '<div class="dr-prog-row"><span>All rewards unlocked ✨</span></div>' +
        '<div class="dr-track"><div class="dr-fill" style="width:100%"></div></div>';
    }
    var pct = Math.min(100, Math.round((avail / next.points) * 100));
    return '<div class="dr-prog-row"><span>Next: ' + esc(next.name) + "</span><span>" + avail + " / " + next.points + "</span></div>" +
      '<div class="dr-track"><div class="dr-fill" style="width:' + pct + '%"></div></div>';
  }

  function render(res, flash) {
    var body = panel.querySelector(".dr-body");
    // — Store credit badge in header —
    var head = panel.querySelector(".dr-head");
    var creditEl = head.querySelector(".dr-credit");
    if (res.loggedIn && res.storeCredit && parseFloat(res.storeCredit.amount) > 0) {
      if (!creditEl) {
        creditEl = document.createElement("div");
        creditEl.className = "dr-credit";
        head.appendChild(creditEl);
      }
      creditEl.innerHTML = "💳 Store Credit: ₹" + parseFloat(res.storeCredit.amount).toLocaleString("en-IN");
    } else if (creditEl) { creditEl.remove(); }
    var rupee = (res.config.pointValuePaise / 100).toFixed(2);
    var h = "";

    if (flash) h += '<div class="dr-card dr-flash">' + flash + "</div>";

    if (res.loggedIn) {
      h +=
        '<div class="dr-card"><div class="dr-points"><div><div class="dr-big">' + res.balance.available +
        '</div><div class="dr-sub">Points available</div></div>' +
        '<div style="text-align:right"><span class="dr-pend">Pending: ' + res.balance.pending +
        '</span><div class="dr-sub" style="margin-top:5px">1 pt = ₹' + rupee + "</div></div></div>" +
        tierHTML(res) + nextRewardHTML(res) + "</div>";
    } else {
      h +=
        '<div class="dr-card"><b>Sign in to see your points</b><br>' +
        '<span class="dr-sub">Earn on every order' +
        (res.config.signupEnabled ? " · +" + res.config.signupPoints + " pts just for joining" : "") +
        '</span><br><a class="dr-btn" style="margin-top:10px" href="' +
        esc(d.accountUrl || "/account") + '">Sign in / Join</a></div>';
    }

    h += '<div class="dr-card"><div class="dr-title">Ways to earn</div><ul class="dr-list">';
    if (res.config.placeOrderEnabled)
      h += "<li>🛒 Place an order — ₹" + res.config.earnAmount + " → " + res.config.earnPoints + " pts</li>";
    if (res.config.signupEnabled)
      h += "<li>✨ Create an account — +" + res.config.signupPoints + " pts</li>";
    h += "</ul></div>";

    if (res.programs.length) {
      h += '<div class="dr-card"><div class="dr-title">Redeem points</div>';
      res.programs.forEach(function (p) {
        var can = res.loggedIn && res.balance.available >= p.points;
        h +=
          '<div class="dr-prog"><div><b>' + esc(p.name) + '</b><div class="dr-sub">' + esc(p.detail) +
          '</div></div><button class="dr-redeem dr-btn" ' + (can ? "" : "disabled ") +
          'data-id="' + p.id + '">' + p.points + " pts</button></div>";
      });
      h += "</div>";
    }

    if (res.coupons && res.coupons.length) {
      h += '<div class="dr-card"><div class="dr-title">My coupons</div>';
      res.coupons.forEach(function (c) {
        h +=
          '<div class="dr-prog"><div><b>' + esc(c.name) + "</b><br>" +
          (c.code
            ? '<span class="dr-code">' + esc(c.code) + "</span>"
            : '<span class="dr-sub">Store credit — select “Apply store credit” at checkout</span>') +
          "</div>" +
          (c.code
            ? '<button class="dr-btn dr-copy" data-code="' + esc(c.code) + '">Copy</button>'
            : "") +
          "</div>";
      });
      h += "</div>";
    }

    body.innerHTML = h;

    body.querySelectorAll(".dr-redeem").forEach(function (btn) {
      btn.addEventListener("click", function () {
        btn.disabled = true;
        btn.textContent = "…";
        xhr("POST", "/apps/rewards/redeem", "program_id=" + encodeURIComponent(btn.dataset.id), function (err, r) {
          if (err || !r || !r.ok) {
            load((r && r.error) ? '<b style="color:#ffd9b3">' + esc(r.error) + "</b>" : '<b style="color:#ffd9b3">Something went wrong</b>');
            return;
          }
          var msg = "🎉 <b>" + esc(r.name) + "</b> redeemed!";
          if (r.code) msg += '<br>Your code: <span class="dr-code">' + esc(r.code) + "</span>";
          else msg += "<br>" + esc(r.detail);
          load(msg);
        });
      });
    });

    body.querySelectorAll(".dr-copy").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var code = btn.dataset.code;
        if (navigator.clipboard) navigator.clipboard.writeText(code);
        btn.textContent = "Copied!";
        setTimeout(function () { btn.textContent = "Copy"; }, 1500);
      });
    });
  }

  function load(flash) {
    xhr("GET", "/apps/rewards/summary", null, function (err, res) {
      var body = panel.querySelector(".dr-body");
      if (err || !res) {
        body.innerHTML = '<div class="dr-card">Could not load rewards. Please try again later.</div>';
        return;
      }
      panel.dataset.loaded = "1";
      render(res, flash || "");
    });
  }
})();

/* ───────── Dropy Free Gift Popup — multi-tier cumulative (config-driven) ───────── */
(function () {
  function gxhr(method, url, body, cb) {
    var x = new XMLHttpRequest();
    x.open(method, url, true);
    x.onload = function () {
      var data = null;
      try { data = JSON.parse(x.responseText); } catch (e) {}
      cb(x.status >= 200 && x.status < 300 ? null : new Error("HTTP " + x.status), data);
    };
    x.onerror = function () { cb(new Error("network"), null); };
    if (body != null) {
      x.setRequestHeader("Content-Type", "application/json");
      x.send(body);
    } else x.send();
  }

  gxhr("GET", "/apps/rewards/gift/config", null, function (err, cfg) {
    if (err || !cfg || !cfg.enabled) return;
    var tiers = cfg.tiers;
    // Back-compat: an older server may only return { threshold, handles }. Synthesize one tier.
    if (!tiers || !tiers.length) {
      if (cfg.handles && cfg.handles.length) {
        tiers = [{ threshold: cfg.threshold || 249900, handles: cfg.handles, label: "free gift" }];
      }
    }
    tiers = (tiers || []).filter(function (t) { return t && t.handles && t.handles.length; });
    if (!tiers.length) return;
    initGifts(tiers);
  });

  function initGifts(tierConfigs) {
    var lastCartTotal = -1;
    var readyCount = 0;
    var allReady = false;

    // Each tier owns its overlay, its variant ids, and its own sessionStorage keys so they are
    // tracked independently. The cart poller below evaluates every tier on each cart change.
    function makeTier(cfg) {
      var threshold = cfg.threshold || 0;
      var handles = cfg.handles || [];
      var label = cfg.label || "free gift";
      var rupees = Math.round(threshold / 100).toLocaleString("en-IN");

      var host = document.createElement("div");
      host.innerHTML =
        '<div class="dropy-gift-overlay">' +
        '<div class="dropy-gift-modal">' +
        '<div class="dropy-gift-header">' +
        '<button class="dropy-gift-close">&times;</button>' +
        "<h3>🎁 Choose Your <span>FREE Gift!</span></h3>" +
        "<p>Pick 1 free gift — on us!</p>" +
        "</div>" +
        '<div class="dropy-gift-body"></div>' +
        '<div class="dropy-gift-footer">1 free ' + label + " included with orders above ₹" + rupees +
        "</div>" +
        "</div>" +
        "</div>";
      var overlay = host.firstChild;
      document.body.appendChild(overlay);
      var bodyEl = overlay.querySelector(".dropy-gift-body");
      var closeBtn = overlay.querySelector(".dropy-gift-close");

      var tier = {
        threshold: threshold,
        handles: handles,
        label: label,
        // per-tier sessionStorage keys (replace the old global keys)
        keyAdded: "dropyGiftWasAdded_" + threshold,
        keyRemoved: "dropyGiftRemoved_" + threshold,
        keySeen: "dropyGiftPopupSeen_" + threshold,
        variantIds: [],
        giftInCart: false,
        ready: false,
        overlay: overlay,
        showPopup: showPopup,
        hidePopup: hidePopup,
      };

      function showPopup() {
        overlay.classList.add("dropy-gift-show");
        document.body.style.overflow = "hidden";
        sessionStorage.setItem(tier.keySeen, "true");
      }
      function hidePopup() {
        overlay.classList.remove("dropy-gift-show");
        document.body.style.overflow = "";
      }
      closeBtn.addEventListener("click", function (e) { e.preventDefault(); hidePopup(); });
      overlay.addEventListener("click", function (e) { if (e.target === overlay) hidePopup(); });

      function loadProducts(callback) {
        var loaded = 0, products = [];
        if (!handles.length) { callback(products); return; }
        handles.forEach(function (handle, i) {
          var x = new XMLHttpRequest();
          x.open("GET", "/products/" + handle + ".js", true);
          x.onload = function () {
            if (x.status === 200) {
              try {
                var p = JSON.parse(x.responseText);
                products[i] = p;
                tier.variantIds.push(p.variants[0].id);
              } catch (e) {}
            }
            loaded++;
            if (loaded === handles.length) callback(products);
          };
          x.onerror = function () {
            loaded++;
            if (loaded === handles.length) callback(products);
          };
          x.send();
        });
      }

      function renderProducts(products) {
        var html = "";
        products.forEach(function (p) {
          if (!p) return;
          var v = p.variants[0];
          var img = p.images[0] ? p.images[0].replace(/(\.\w+)\?/, "_200x200$1?") : "";
          var originalPrice = (v.compare_at_price || v.price) / 100;
          html += '<div class="dropy-gift-card" data-variant-id="' + v.id + '">';
          html += '<img class="dropy-gift-img" src="' + img + '" alt="' + p.title + '">';
          html += '<div class="dropy-gift-info">';
          html += '<p class="dropy-gift-name">' + p.title + "</p>";
          html +=
            '<p class="dropy-gift-price"><s>₹' + originalPrice.toLocaleString("en-IN") + "</s><span>FREE</span></p>";
          html += "</div>";
          html += '<button class="dropy-gift-btn" data-variant-id="' + v.id + '">Add</button>';
          html += "</div>";
        });
        bodyEl.innerHTML = html;

        bodyEl.querySelectorAll(".dropy-gift-btn").forEach(function (btn) {
          btn.addEventListener("click", function (e) {
            e.stopPropagation();
            var variantId = btn.getAttribute("data-variant-id");
            var card = btn.closest(".dropy-gift-card");
            card.classList.add("dropy-gift-adding");
            btn.textContent = "Adding...";
            gxhr("POST", "/cart/add.js", JSON.stringify({ id: parseInt(variantId), quantity: 1 }), function (err) {
              if (err) {
                btn.textContent = "Retry";
                card.classList.remove("dropy-gift-adding");
                return;
              }
              btn.textContent = "Added ✓";
              btn.classList.add("dropy-gift-btn-done");
              card.classList.remove("dropy-gift-adding");
              card.classList.add("dropy-gift-added");
              tier.giftInCart = true;
              sessionStorage.setItem(tier.keyAdded, "true");
              bodyEl.querySelectorAll(".dropy-gift-btn").forEach(function (b) {
                if (b !== btn) {
                  b.disabled = true;
                  b.style.opacity = "0.4";
                }
              });
              removeClaimButtons();
              setTimeout(function () {
                hidePopup();
                window.location.reload();
              }, 600);
            });
          });
        });
        bodyEl.querySelectorAll(".dropy-gift-card").forEach(function (card) {
          card.addEventListener("click", function () {
            var btn = card.querySelector(".dropy-gift-btn");
            if (btn && !btn.classList.contains("dropy-gift-btn-done") && !btn.disabled) btn.click();
          });
        });
      }

      loadProducts(function (products) {
        renderProducts(products);
        tier.ready = true;
        onTierReady();
      });

      return tier;
    }

    function onTierReady() {
      readyCount++;
      if (readyCount === tierConfigs.length) {
        allReady = true;
        setTimeout(pollCart, 300);
      }
    }

    var tiers = tierConfigs.map(function (cfg) { return makeTier(cfg); });

    function allGiftVariantIds() {
      var ids = [];
      tiers.forEach(function (t) {
        for (var i = 0; i < t.variantIds.length; i++) ids.push(t.variantIds[i]);
      });
      return ids;
    }

    function anyPopupOpen() {
      return tiers.some(function (t) { return t.overlay.classList.contains("dropy-gift-show"); });
    }

    function removeClaimButtons() {
      document.querySelectorAll(".dropy-gift-claim").forEach(function (el) { el.remove(); });
    }
    function addClaimButton(tier) {
      removeClaimButtons(); // single claim button, pointed at the given tier
      var targets = document.querySelectorAll(".cart-drawer__free-shipping, .main-cart__free-shipping");
      targets.forEach(function (target) {
        if (target.querySelector(".dropy-gift-claim")) return;
        var btn = document.createElement("button");
        btn.className = "dropy-gift-claim";
        btn.innerHTML = "🎁 Claim Your FREE Gift";
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          tier.showPopup();
        });
        target.appendChild(btn);
      });
    }

    function highestOf(list) {
      var top = list[0];
      list.forEach(function (t) { if (t.threshold > top.threshold) top = t; });
      return top;
    }

    function pollCart() {
      if (!allReady) return;
      var x = new XMLHttpRequest();
      x.open("GET", "/cart.js?_=" + Date.now(), true);
      x.onload = function () {
        if (x.status !== 200) return;
        var c;
        try { c = JSON.parse(x.responseText); } catch (e) { return; }
        var total = c.total_price || 0;
        var items = c.items || [];
        var allIds = allGiftVariantIds();

        // totalWithoutGift subtracts EVERY tier's gift variants, not just one tier's.
        var totalWithoutGift = total;
        items.forEach(function (item) {
          if (allIds.indexOf(item.variant_id) !== -1) totalWithoutGift -= item.final_line_price;
        });

        // each tier's "gift in cart" check uses that tier's own variant ids
        tiers.forEach(function (t) {
          t.giftInCart = false;
          for (var i = 0; i < items.length; i++) {
            if (t.variantIds.indexOf(items[i].variant_id) !== -1) { t.giftInCart = true; break; }
          }
        });

        var totalChanged = total !== lastCartTotal;
        var increased = total > lastCartTotal;
        if (totalChanged) lastCartTotal = total;

        tiers.forEach(function (t) {
          // locate this tier's gift line in the live cart, if present
          var giftLine = null;
          for (var gi = 0; gi < items.length; gi++) {
            if (t.variantIds.indexOf(items[gi].variant_id) !== -1) { giftLine = items[gi]; break; }
          }

          // crossing this tier's threshold upward re-arms a prior removal
          if (totalChanged && increased && !t.giftInCart && totalWithoutGift >= t.threshold) {
            sessionStorage.removeItem(t.keyRemoved);
          }
          // gift was added then vanished = user removed it themselves; don't re-pop
          if (!t.giftInCart && sessionStorage.getItem(t.keyAdded) === "true") {
            sessionStorage.setItem(t.keyRemoved, "true");
          }
          // back below this tier -> re-arm the popup for the next crossing
          if (totalWithoutGift < t.threshold) {
            sessionStorage.removeItem(t.keySeen);
          }

          // ENFORCE threshold + single-qty, mirroring what a Bxgy does natively.
          // Cart broker re-syncs after each /cart/change.js, so we never self-trigger (no loop).
          // 2s per-tier cooldown caps request rate -> a failed/rate-limited call can't storm.
          if (giftLine && (Date.now() - (t._lastFix || 0) > 2000)) {
            if (totalWithoutGift < t.threshold) {
              t._lastFix = Date.now();
              sessionStorage.setItem(t.keyRemoved, "true");
              gxhr("POST", "/cart/change.js", JSON.stringify({ id: giftLine.key, quantity: 0 }), function () {});
            } else if (totalWithoutGift >= t.threshold && giftLine.quantity > 1) {
              t._lastFix = Date.now();
              gxhr("POST", "/cart/change.js", JSON.stringify({ id: giftLine.key, quantity: 1 }), function () {});
            }
          }
        });

        // cumulative: every unlocked tier whose gift isn't in the cart is independently eligible
        var eligible = tiers.filter(function (t) {
          return totalWithoutGift >= t.threshold && !t.giftInCart;
        });

        if (eligible.length) {
          var highest = highestOf(eligible);
          setTimeout(function () { addClaimButton(highest); }, 300);

          // auto-popup at most one tier (the highest unclaimed & unseen) — never stack overlays.
          var toShow = eligible.filter(function (t) {
            return sessionStorage.getItem(t.keySeen) !== "true" && sessionStorage.getItem(t.keyRemoved) !== "true";
          });
          if (toShow.length && !anyPopupOpen()) {
            highestOf(toShow).showPopup();
          }
        } else {
          removeClaimButtons();
        }
      };
      x.send();
    }

    window.dropyGiftSync = pollCart;
  }
})();(function () {
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

  // dropy.in's /cart.js can desync (returns empty while the page shows items).
  // This reads the visible cart count as a fallback so the popup still fires.
  function domCartCount() {
    // Common cart count bubble selectors (Maximize theme + generic patterns)
    var sels = [
      ".cart-count-bubble", ".cart-count", "[data-cart-count]",
      ".header__cart-count", ".cart-link__bubble", ".js-cart-count",
      "#CartCount", ".site-header__cart-count", ".cart-item-count"
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el) {
        var n = parseInt((el.textContent || "").replace(/\D/g, ""), 10);
        if (!isNaN(n)) return n;
      }
    }
    // On the cart page itself: count line-item rows
    if (isCartPage()) {
      var rows = document.querySelectorAll(
        ".cart-item, .cart__row, [data-cart-item], tr.cart-item, .line-item"
      );
      if (rows.length) return rows.length;
    }
    return null; // unknown
  }

  // Returns true if the cart has items, using /cart.js first then DOM fallback.
  function cartHasItems() {
    if (cart && typeof cart.item_count === "number" && cart.item_count > 0) return true;
    var dom = domCartCount();
    if (dom !== null) return dom > 0;
    // Both unknown: don't block (assume they have something — exit intent implies browsing)
    return cart === null;
  }


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

    // 7. Cart must have items (with DOM fallback for broken /cart.js)
    if (!cartHasItems()) return;

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
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-modal", "true");
    popup.setAttribute("aria-label", "Cart reminder");

    var cartTotal = (cart && cart.total_price) ? "₹" + (cart.total_price / 100).toLocaleString("en-IN") : "";
    var itemCount = (cart && cart.item_count) ? cart.item_count : 0;

    // ── Header band (brand moment) ──
    var html =
      '<div class="dei-header">' +
        '<div class="dei-handle"></div>' +
        '<button class="dei-close" aria-label="Close">&times;</button>' +
        '<span class="dei-eyebrow">Don\u2019t miss out</span>' +
        '<h2 class="dei-heading">' + esc(tier.heading) + '</h2>' +
      '</div>';

    // ── Content body ──
    html += '<div class="dei-content">';
    html += '<p class="dei-body">' + esc(tier.body) + '</p>';

    // Hero cart-value anchor (only when we have real totals)
    if (cartTotal && itemCount) {
      html +=
        '<div class="dei-value">' +
          '<span class="dei-value-amount">' + cartTotal + '</span>' +
          '<span class="dei-value-label">waiting in your cart \u00b7 ' + itemCount + ' item' + (itemCount > 1 ? 's' : '') + '</span>' +
        '</div>';
    }

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
        '<span>Apply at checkout</span>' +
        '<span class="dei-discount-code">' + esc(tier.discount) + '</span>' +
        '</div>';
    }

    // CTA
    html += '<a class="dei-cta" href="/checkout">' + esc(p.cta_text || "Complete My Order") + '</a>';
    html += '<button class="dei-secondary">Keep shopping</button>';

    // Trust footer
    html +=
      '<div class="dei-trust">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' +
        '<span>100% Authentic \u00b7 Directly imported from the USA</span>' +
      '</div>';

    html += '</div>'; // .dei-content

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
    if (!cartHasItems()) return;
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
      var labelText = String(t.label || "Items reserved for you")
        .replace(/^[\s\uD800-\uDFFF\u2300-\u27BF\uFE0F\u200D]+/, "").trim() || "Items reserved for you";

      var bar = document.createElement("div");
      bar.className = "dei-timer-bar";
      bar.innerHTML =
        '<div class="dei-timer-row">' +
          '<svg class="dei-timer-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
          '<span class="dei-timer-label">' + esc(labelText) + '</span>' +
          '<span class="dei-timer-countdown">--:--</span>' +
        '</div>' +
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
      // Also intercept XHR to /cart/add — but ONLY relative cart paths, and never
      // touch Shopify's internal beacon/telemetry URLs (which break on URL parsing).
      var origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try {
          if (typeof url === "string" && url.charAt(0) === "/" && url.indexOf("/cart/add") === 0) {
            this.addEventListener("load", function () {
              resetTimer();
            });
          }
        } catch (e) { /* never let our hook break the host XHR */ }
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

/* ═══════════════════════════════════════════════════════════
   DROPY WISHLIST  (hybrid: localStorage + customer metafield)
   - Hearts on PDP, collection cards, and a header icon w/ badge
   - Guests persist to localStorage; logged-in users sync to metafield
   - /pages/wishlist renders client-side from localStorage
   ═══════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var LS_KEY = "dropy_wishlist";
  var PROXY = "/apps/rewards/wishlist";
  var SYNC_FLAG = "dropy_wl_synced"; // session flag so we hydrate once per load

  // ---- localStorage helpers (rich objects keyed by handle) ----
  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function save(arr) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch (e) {}
  }
  function has(handle) { return load().some(function (i) { return i.handle === handle; }); }
  function gidOf(handle) {
    var f = load().filter(function (i) { return i.handle === handle; })[0];
    return f ? f.id : null;
  }
  function count() { return load().length; }

  function isLoggedIn() {
    var root = document.getElementById("dropy-rewards-root");
    return root && root.getAttribute("data-logged-in") === "1";
  }
  function accountUrl() {
    var root = document.getElementById("dropy-rewards-root");
    return (root && root.getAttribute("data-account-url")) || "/account";
  }

  // ---- tiny XHR (fetch is intercepted by sound scripts on dropy.in) ----
  function post(path, payload, cb) {
    try {
      var x = new XMLHttpRequest();
      x.open("POST", path, true);
      x.setRequestHeader("Content-Type", "application/json");
      x.onreadystatechange = function () {
        if (x.readyState === 4) {
          var d = null; try { d = JSON.parse(x.responseText); } catch (e) {}
          cb(x.status >= 200 && x.status < 300 ? null : x.status, d);
        }
      };
      x.send(JSON.stringify(payload));
    } catch (e) { cb(e, null); }
  }
  function get(path, cb) {
    try {
      var x = new XMLHttpRequest();
      x.open("GET", path, true);
      x.onreadystatechange = function () {
        if (x.readyState === 4) {
          var d = null; try { d = JSON.parse(x.responseText); } catch (e) {}
          cb(x.status >= 200 && x.status < 300 ? null : x.status, d);
        }
      };
      x.send();
    } catch (e) { cb(e, null); }
  }

  function fmtPrice(n) {
    try {
      return "₹" + Math.round(Number(n)).toLocaleString("en-IN");
    } catch (e) { return "₹" + n; }
  }

  // ---- handle extraction from a /products/<handle> URL ----
  function handleFromUrl(href) {
    if (!href) return null;
    var m = href.match(/\/products\/([a-z0-9\-_%]+)/i);
    return m ? m[1].split("?")[0].split("#")[0] : null;
  }

  // ---- heart SVG ----
  function heartSVG(filled) {
    return (
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
      (filled
        ? '<path fill="#ef4444" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>'
        : '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M12 20.1l-1.05-.95C6.14 14.78 3 11.94 3 8.5 3 5.96 5.04 4 7.5 4c1.55 0 3.04.77 3.95 1.98L12 6.6l.55-.62C13.46 4.77 14.95 4 16.5 4 18.96 4 21 5.96 21 8.5c0 3.44-3.14 6.28-7.95 10.65L12 20.1z"/>') +
      "</svg>"
    );
  }

  // ---- refresh all heart visuals + header badge ----
  function refresh() {
    var hearts = document.querySelectorAll(".dw-heart[data-handle]");
    hearts.forEach(function (h) {
      var on = has(h.getAttribute("data-handle"));
      h.classList.toggle("dw-on", on);
      h.innerHTML = heartSVG(on);
      h.setAttribute("aria-pressed", on ? "true" : "false");
      h.setAttribute("aria-label", on ? "Remove from wishlist" : "Add to wishlist");
    });
    var badges = document.querySelectorAll(".dw-badge");
    var c = count();
    badges.forEach(function (b) {
      b.textContent = c;
      b.style.display = c > 0 ? "flex" : "none";
    });
  }

  // ---- toggle one product by handle ----
  function toggle(handle, btn) {
    if (!handle) return;
    if (has(handle)) {
      // remove
      var gid = gidOf(handle);
      save(load().filter(function (i) { return i.handle !== handle; }));
      refresh();
      if (isLoggedIn() && gid) post(PROXY + "/toggle", { productId: gid, action: "remove" }, function () {});
      flash(btn, "Removed");
    } else {
      // add — fetch product data so the wishlist page can render it
      if (btn) btn.classList.add("dw-loading");
      get("/products/" + handle + ".js", function (err, p) {
        if (btn) btn.classList.remove("dw-loading");
        if (err || !p || !p.id) { flash(btn, "Try again"); return; }
        var gid = "gid://shopify/Product/" + p.id;
        var img = (p.featured_image || (p.images && p.images[0]) || "");
        if (img && img.indexOf("//") === 0) img = "https:" + img;
        var item = {
          id: gid,
          handle: handle,
          title: p.title || "",
          url: p.url || "/products/" + handle,
          image: img,
          price: (p.price || 0) / 100,
          compareAt: p.compare_at_price && p.compare_at_price > p.price ? p.compare_at_price / 100 : 0,
          available: p.available !== false
        };
        var arr = load();
        if (!arr.some(function (i) { return i.handle === handle; })) arr.push(item);
        save(arr);
        refresh();
        if (isLoggedIn()) post(PROXY + "/toggle", { productId: gid, action: "add" }, function () {});
        flash(btn, "Saved ♥");
      });
    }
  }

  // ---- little toast near a heart ----
  function flash(btn, msg) {
    if (!btn) return;
    var t = document.createElement("span");
    t.className = "dw-flash";
    t.textContent = msg;
    btn.appendChild(t);
    setTimeout(function () { t.classList.add("dw-flash-show"); }, 10);
    setTimeout(function () {
      t.classList.remove("dw-flash-show");
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
    }, 1100);
  }

  // ---- build a heart button element ----
  function makeHeart(handle, variant) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "dw-heart" + (variant ? " dw-heart--" + variant : "");
    b.setAttribute("data-handle", handle);
    b.innerHTML = heartSVG(false);
    b.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggle(handle, b);
    });
    return b;
  }

  // ---- inject hearts onto collection / grid product cards ----
  function injectCards() {
    // Maximize theme: one heart per card, anchored in the image wrapper
    var wraps = document.querySelectorAll(".product-card__image-wrapper");
    wraps.forEach(function (wrap) {
      if (wrap.getAttribute("data-dw") === "done" || wrap.querySelector(".dw-heart")) return;
      var card = wrap.closest(".product-card__wrapper, .grid-item") || wrap;
      var link = wrap.querySelector('a[href*="/products/"]') ||
                 card.querySelector('a[href*="/products/"]');
      var handle = link ? handleFromUrl(link.getAttribute("href")) : null;
      if (!handle) return;
      wrap.setAttribute("data-dw", "done");
      if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
      wrap.appendChild(makeHeart(handle, "card"));
    });

    // Fallback ONLY for non-Maximize sections (no .product-card__image-wrapper anywhere on page)
    if (document.querySelector(".product-card__image-wrapper")) return;
    var links = document.querySelectorAll('a[href*="/products/"]');
    links.forEach(function (a) {
      if (a.closest('[class*="cart-drawer"], [class*="cart-item"]')) return;
      // only match true card CONTAINERS, never title/price/sub elements
      var card = a.closest('.card, .grid__item, li.grid__item, .product-item, [class*="card-wrapper"]');
      if (!card || card.getAttribute("data-dw") === "done" || card.querySelector(".dw-heart")) return;
      var handle = handleFromUrl(a.getAttribute("href"));
      if (!handle) return;
      card.setAttribute("data-dw", "done");
      var imgBox = card.querySelector('[class*="image-wrapper"], [class*="image-container"], [class*="media"]') || card;
      if (getComputedStyle(imgBox).position === "static") imgBox.style.position = "relative";
      imgBox.appendChild(makeHeart(handle, "card"));
    });
  }

  // ---- inject heart on the product (PDP) ----
  function injectPDP() {
    if (location.pathname.indexOf("/products/") === -1) return;
    var handle = handleFromUrl(location.pathname);
    if (!handle) return;
    if (document.querySelector(".dw-heart--pdp")) return;
    var anchor =
      document.querySelector('product-form, form[action*="/cart/add"]') ||
      document.querySelector('[class*="product-form"]') ||
      document.querySelector('[class*="product__info"], [class*="product-info"]');
    if (!anchor) return;
    var wrap = document.createElement("div");
    wrap.className = "dw-pdp-row";
    var h = makeHeart(handle, "pdp");
    var label = document.createElement("span");
    label.className = "dw-pdp-label";
    label.textContent = "Add to Wishlist";
    wrap.appendChild(h);
    wrap.appendChild(label);
    label.addEventListener("click", function (e) { e.preventDefault(); toggle(handle, h); });
    anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
  }

  // ---- desktop header icon (before .dropy-credit) + mobile nav item ----
  function injectHeader() {
    // DESKTOP: insert before the store-credit icon
    if (!document.querySelector(".dw-header-icon")) {
      var credit = document.querySelector(".dropy-credit");
      var cart = document.querySelector(".header-icon-cart, a[href*='/cart']");
      var ref = credit || cart;
      if (ref && ref.parentNode) {
        var a = document.createElement("a");
        a.href = "/pages/wishlist";
        a.className = "dw-header-icon";
        a.setAttribute("aria-label", "Wishlist");
        a.innerHTML =
          '<svg class="dw-hdr-heart" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">' +
          '<path fill="#ef4444" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>' +
          '</svg>' +
          '<span class="dw-badge" style="display:none">0</span>';
        ref.parentNode.insertBefore(a, ref);
      }
    }

    // MOBILE: add a Wishlist item into the bottom nav, matching its markup
    if (!document.querySelector(".dw-mobile-nav-item")) {
      var navRow = document.querySelector("#bottom-mobile-nav .flex");
      if (navRow) {
        var sample = navRow.querySelector("a[aria-label]");
        var item = document.createElement("a");
        item.href = "/pages/wishlist";
        item.className = (sample ? sample.className : "group flex flex-col items-center justify-center min-w-[64px] min-h-[44px] gap-0.5") + " dw-mobile-nav-item";
        item.setAttribute("aria-label", "Wishlist");
        var iconCls = "icon w-6 h-6";
        var sIcon = sample ? sample.querySelector(".icon") : null;
        if (sIcon) iconCls = sIcon.className;
        var sLabel = sample ? sample.querySelector("span:not(.icon):not([aria-hidden])") : null;
        var labelCls = sLabel ? sLabel.className : "text-[11px]";
        // outline heart matching the theme's 24px outline icons (stroke, no fill)
        var navHeart =
          '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
          '<path d="M12 20.25C12 20.25 3.75 15.5 3.75 9.6875C3.75 7.2 5.7 5.25 8.1875 5.25C9.7 5.25 11.05 6.0 12 7.2C12.95 6.0 14.3 5.25 15.8125 5.25C18.3 5.25 20.25 7.2 20.25 9.6875C20.25 15.5 12 20.25 12 20.25Z" stroke="#303030" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>';
        item.innerHTML =
          '<span class="' + iconCls + ' dw-mnav-icon">' + navHeart +
          '<span class="dw-badge dw-badge--mnav" style="display:none">0</span></span>' +
          '<span class="' + labelCls + '">Wishlist</span>';
        var items = navRow.querySelectorAll("a[aria-label]");
        var last = items[items.length - 1];
        if (last) navRow.insertBefore(item, last);
        else navRow.appendChild(item);
      }
    }
  }

  // ---- render the dedicated wishlist page ----
  function renderPage() {
    var root = document.getElementById("dropy-wishlist-root");
    if (!root) return;
    var items = load();
    if (!items.length) {
      root.innerHTML =
        '<div class="dw-empty">' +
        '<div class="dw-empty-heart">' + heartSVG(false) + "</div>" +
        "<h3>Your wishlist is empty</h3>" +
        "<p>Tap the heart on any product to save it here.</p>" +
        '<a class="dw-empty-cta" href="/collections/all">Start shopping</a>' +
        "</div>";
      return;
    }
    var html = '<div class="dw-grid">';
    items.forEach(function (i) {
      var disc =
        i.compareAt && i.compareAt > i.price
          ? '<span class="dw-card-cmp">' + fmtPrice(i.compareAt) + "</span>"
          : "";
      html +=
        '<div class="dw-card" data-handle="' + i.handle + '">' +
        '<button type="button" class="dw-card-remove" data-handle="' + i.handle + '" aria-label="Remove">×</button>' +
        '<a class="dw-card-img" href="' + i.url + '">' +
        (i.image ? '<img src="' + i.image + '" alt="" loading="lazy">' : '<div class="dw-card-noimg"></div>') +
        "</a>" +
        '<a class="dw-card-title" href="' + i.url + '">' + i.title + "</a>" +
        '<div class="dw-card-price">' + fmtPrice(i.price) + " " + disc + "</div>" +
        (i.available
          ? '<button type="button" class="dw-card-atc" data-handle="' + i.handle + '">Add to cart</button>'
          : '<button type="button" class="dw-card-atc dw-soldout" disabled>Sold out</button>') +
        "</div>";
    });
    html += "</div>";
    root.innerHTML = html;

    // remove buttons
    root.querySelectorAll(".dw-card-remove").forEach(function (b) {
      b.addEventListener("click", function () {
        var handle = b.getAttribute("data-handle");
        var gid = gidOf(handle);
        save(load().filter(function (i) { return i.handle !== handle; }));
        if (isLoggedIn() && gid) post(PROXY + "/toggle", { productId: gid, action: "remove" }, function () {});
        renderPage();
        refresh();
      });
    });
    // add-to-cart buttons
    root.querySelectorAll(".dw-card-atc:not(.dw-soldout)").forEach(function (b) {
      b.addEventListener("click", function () {
        var handle = b.getAttribute("data-handle");
        b.textContent = "Adding…";
        get("/products/" + handle + ".js", function (err, p) {
          if (err || !p || !p.variants || !p.variants.length) { b.textContent = "Try again"; return; }
          var vid = (p.variants.filter(function (v) { return v.available; })[0] || p.variants[0]).id;
          post("/cart/add.js", { items: [{ id: vid, quantity: 1 }] }, function (e2) {
            if (e2) { b.textContent = "Try again"; return; }
            b.textContent = "Added ✓";
            document.dispatchEvent(new CustomEvent("dropy:cart-updated"));
            setTimeout(function () { b.textContent = "Add to cart"; }, 1500);
          });
        });
      });
    });
  }

  // ---- one-time hydrate from metafield (cross-device + guest→login merge) ----
  function hydrate(done) {
    if (!isLoggedIn()) { done(); return; }
    if (sessionStorage.getItem(SYNC_FLAG)) { done(); return; }
    sessionStorage.setItem(SYNC_FLAG, "1");
    get(PROXY + "/list", function (err, res) {
      if (err || !res || !res.items) { done(); return; }
      var local = load();
      var byHandle = {};
      local.forEach(function (i) { byHandle[i.handle] = i; });
      // merge server items into local (server has rich data too)
      res.items.forEach(function (s) { byHandle[s.handle] = s; });
      var merged = Object.keys(byHandle).map(function (k) { return byHandle[k]; });
      save(merged);

      // push any local-only (guest-saved) GIDs up to the metafield
      var serverHandles = {};
      res.items.forEach(function (s) { serverHandles[s.handle] = 1; });
      local.forEach(function (i) {
        if (!serverHandles[i.handle] && i.id) {
          post(PROXY + "/toggle", { productId: i.id, action: "add" }, function () {});
        }
      });
      done();
    });
  }

  // ---- init ----
  function init() {
    injectHeader();
    injectPDP();
    injectCards();
    renderPage();
    refresh();
    hydrate(function () { refresh(); renderPage(); });

    // Re-scan ONLY the product grid (not whole body) — avoids scroll jank.
    // Scope to the grid container; fall back to body only if grid not found.
    var target =
      document.getElementById("ProductGridContainer") ||
      document.querySelector('[class*="grid-layout"], .anm-reveal-container') ||
      null;

    if (target) {
      var pending = null;
      var mo = new MutationObserver(function () {
        clearTimeout(pending);
        pending = setTimeout(function () {
          injectCards();
          refresh();
        }, 500);
      });
      mo.observe(target, { childList: true, subtree: true });
    }

    // Header/PDP only need one extra check after late-loading theme JS — no observer.
    setTimeout(function () { injectHeader(); injectPDP(); injectCards(); refresh(); }, 1200);

    // Re-check on browser back/forward (bfcache) and page show
    window.addEventListener("pageshow", function () { refresh(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
