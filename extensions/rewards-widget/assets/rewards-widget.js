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

  var open = false;
  function toggle(v) {
    open = v;
    panel.classList.toggle("dr-open", open);
    if (open && !panel.dataset.loaded) load();
  }
  door.addEventListener("click", function () { toggle(!open); });
  panel.querySelector(".dr-x").addEventListener("click", function () { toggle(false); });

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
    var rupee = (res.config.pointValuePaise / 100).toFixed(2);
    var h = "";

    if (flash) h += '<div class="dr-card dr-flash">' + flash + "</div>";

    if (res.loggedIn) {
      h +=
        '<div class="dr-card"><div class="dr-points"><div><div class="dr-big">' + res.balance.available +
        '</div><div class="dr-sub">Points available</div></div>' +
        '<div style="text-align:right"><span class="dr-pend">Pending: ' + res.balance.pending +
        '</span><div class="dr-sub" style="margin-top:5px">1 pt = ₹' + rupee + "</div></div></div>" +
        nextRewardHTML(res) + "</div>";
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
            : '<span class="dr-sub">Store credit — auto-applies at checkout</span>') +
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
            load((r && r.error) ? '<b style="color:#c2410c">' + esc(r.error) + "</b>" : '<b style="color:#c2410c">Something went wrong</b>');
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