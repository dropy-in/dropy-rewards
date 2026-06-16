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
})();