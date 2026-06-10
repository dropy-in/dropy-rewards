(function () {
  var root = document.getElementById("dropy-rewards-root");
  if (!root) return;
  var d = root.dataset;
  var C = d.themeColor || "#FB923C";
  var pos = d.position === "left" ? "left" : "right";

  function xhr(url, cb) {
    var x = new XMLHttpRequest();
    x.open("GET", url, true);
    x.onload = function () {
      if (x.status >= 200 && x.status < 300) {
        try { cb(null, JSON.parse(x.responseText)); } catch (e) { cb(e); }
      } else cb(new Error("HTTP " + x.status));
    };
    x.onerror = function () { cb(new Error("network")); };
    x.send();
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  var ICON =
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 7h-2.2c.13-.31.2-.65.2-1a3 3 0 0 0-5.2-2.05L12 4.9l-.8-.95A3 3 0 0 0 6 6c0 .35.07.69.2 1H4a2 2 0 0 0-2 2v2h20V9a2 2 0 0 0-2-2Zm-9-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm6 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM3 13v6a2 2 0 0 0 2 2h6v-8H3Zm10 8h6a2 2 0 0 0 2-2v-6h-8v8Z"/></svg>';

  // door
  var door = document.createElement("button");
  door.className = "dr-door dr-" + pos;
  door.style.background = C;
  var style = d.doorStyle || "icon_text";
  door.innerHTML =
    (style !== "text" ? ICON : "") +
    (style !== "icon" ? "<span>" + esc(d.doorText || "Rewards") + "</span>" : "");
  document.body.appendChild(door);

  // panel
  var panel = document.createElement("div");
  panel.className = "dr-panel dr-" + pos;
  panel.innerHTML =
    '<div class="dr-head" style="background:' + C + '">' +
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

  function load() {
    xhr("/apps/rewards/summary", function (err, res) {
      var body = panel.querySelector(".dr-body");
      if (err || !res) {
        body.innerHTML = '<div class="dr-card">Could not load rewards. Please try again later.</div>';
        return;
      }
      panel.dataset.loaded = "1";
      var rupee = (res.config.pointValuePaise / 100).toFixed(2);
      var h = "";

      if (res.loggedIn) {
        h +=
          '<div class="dr-card dr-points"><div><div class="dr-big">' + res.balance.available +
          '</div><div class="dr-sub">Points available</div></div>' +
          '<div><div class="dr-pend">Pending: ' + res.balance.pending +
          '</div><div class="dr-sub">1 pt = ₹' + rupee + "</div></div></div>";
      } else {
        h +=
          '<div class="dr-card"><b>Sign in to see your points</b><br>' +
          '<span class="dr-sub">Earn on every order' +
          (res.config.signupEnabled ? " · +" + res.config.signupPoints + " pts just for joining" : "") +
          '</span><br><a class="dr-btn" style="background:' + C + '" href="' +
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
            'style="background:' + (can ? C : "#ccc") + '" data-id="' + p.id + '">' +
            p.points + " pts</button></div>";
        });
        h += '<div class="dr-sub" style="margin-top:6px">Redemption launching soon ⏳</div></div>';
      }

      body.innerHTML = h;
    });
  }
})();