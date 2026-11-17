/* miastodziczenie — mapa zdjęć.
 * Dane: config.json (mapa, tagi) + data/zdjecia.json (generowane przez scripts/build.py).
 */
(function () {
  "use strict";

  var root = document.getElementById("miastodziczenie");
  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  // Ścieżki liczone względem tego skryptu — działa niezależnie od adresu strony.
  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/assets\/app\.js(\?.*)?$/, "") : "";
  })();
  var url = function (p) { return /^(https?:)?\/\//.test(p) ? p : BASE + p; };

  var mobile = window.matchMedia("(max-width: 760px)");
  var pinSize = function () { return mobile.matches ? 40 : 48; };

  var state = {
    config: null,
    photos: [],
    tagOrder: [],
    selected: new Set(),
    mode: "any",          // "any" = dowolny z zaznaczonych, "all" = wszystkie zaznaczone
    visible: [],
    current: -1
  };
  var map;

  // ------------------------------------------------------------------ start
  Promise.all([
    fetch(url("config.json"), { cache: "no-cache" }).then(json),
    fetch(url("data/zdjecia.json"), { cache: "no-cache" }).then(json)
  ]).then(function (res) {
    state.config = res[0];
    state.photos = (res[1].zdjecia || []).slice().sort(function (a, b) {
      return a.id.localeCompare(b.id, "pl", { numeric: true });
    });
    fillTexts();
    buildTags();
    readHash();
    return buildMap();
  }).then(function () {
    bindUi();
    applyFilter(false);
    if (state.pendingPhoto) {
      var i = state.visible.indexOf(state.pendingPhoto);
      if (i >= 0) openViewer(i);
    }
  }).catch(function (err) {
    console.error(err);
    $(".md-map").innerHTML = '<p class="md-error">Nie udało się wczytać mapy lub danych (' +
      escapeHtml(err.message) + ').<br>Jeśli otwierasz plik lokalnie, uruchom serwer: ' +
      '<code>python3 -m http.server</code></p>';
  });

  function json(r) {
    if (!r.ok) throw new Error(r.url + " → " + r.status);
    return r.json();
  }

  function fillTexts() {
    $$("[data-md]").forEach(function (el) {
      var v = state.config[el.getAttribute("data-md")];
      if (v) el.textContent = v;
    });
    if (state.config.tytul) document.title = state.config.tytul + " — Nowy Teatr";
  }

  // ------------------------------------------------------------------ tagi
  // Tag w config.json: "0": "nazwa"  albo  "0": { "nazwa": "…", "kolor": "#…" }
  function tagInfo(code) {
    var t = (state.config.tagi || {})[code];
    if (t == null) return { nazwa: code, kolor: "" };
    if (typeof t === "string") return { nazwa: t, kolor: "" };
    return { nazwa: t.nazwa != null ? t.nazwa : code, kolor: t.kolor || "" };
  }
  function tagName(code) { return tagInfo(code).nazwa; }
  function tagStyle(code) {
    var k = tagInfo(code).kolor;
    return k ? ' style="--c:' + escapeHtml(k) + '"' : "";
  }

  function buildTags() {
    var counts = {};
    state.photos.forEach(function (p) {
      p.tagi.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    var order = Object.keys(state.config.tagi || {});
    Object.keys(counts).sort().forEach(function (t) { if (order.indexOf(t) < 0) order.push(t); });
    state.tagOrder = order;
    order.forEach(function (t) { state.selected.add(t); });

    $(".md-tags").innerHTML = order.map(function (t) {
      return '<li><button type="button" class="md-tag" aria-pressed="true" data-tag="' + escapeHtml(t) + '"' + tagStyle(t) + '>' +
        escapeHtml(tagName(t)) + " <small>" + (counts[t] || 0) + "</small></button></li>";
    }).join("");
  }

  function syncTagButtons() {
    $$(".md-tag").forEach(function (b) {
      b.setAttribute("aria-pressed", state.selected.has(b.getAttribute("data-tag")) ? "true" : "false");
    });
    $$(".md-mode button").forEach(function (b) {
      b.setAttribute("aria-checked", b.getAttribute("data-mode") === state.mode ? "true" : "false");
    });
  }

  function matches(p) {
    var sel = state.selected;
    if (!sel.size) return false;
    if (state.mode === "all") {
      var ok = true;
      sel.forEach(function (t) { if (p.tagi.indexOf(t) < 0) ok = false; });
      return ok;
    }
    if (!p.tagi.length) return sel.size === state.tagOrder.length; // bez tagów: tylko przy „wszystkich”
    return p.tagi.some(function (t) { return sel.has(t); });
  }

  // ------------------------------------------------------------------ mapa
  function buildMap() {
    var m = state.config.mapa || {};
    var g = m.granice || [[20.85, 52.09], [21.28, 52.37]]; // [zachód, południe], [wschód, północ]
    var bounds = new maplibregl.LngLatBounds(g[0], g[1]);
    var dx = (g[1][0] - g[0][0]) * 0.6, dy = (g[1][1] - g[0][1]) * 0.6;

    map = new maplibregl.Map({
      container: $(".md-map"),
      style: m.styl || "https://tiles.openfreemap.org/styles/positron",
      bounds: bounds,
      fitBoundsOptions: { padding: 20 },
      maxBounds: [[g[0][0] - dx, g[0][1] - dy], [g[1][0] + dx, g[1][1] + dy]],
      minZoom: 9,
      maxZoom: 19,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true }
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

    state.photos.forEach(function (p) {
      var el = document.createElement("div");
      el.className = "md-marker";
      // --tc = kolor pierwszego tagu (obramówka po najechaniu myszą)
      var tc = p.tagi.length ? tagInfo(p.tagi[0]).kolor : "";
      el.innerHTML = '<div class="md-pin" style="background-image:url(\'' + url(p.miniatura) + '\')' +
        (tc ? ";--tc:" + escapeHtml(tc) : "") + '"></div>';
      // Proporcje bierzemy z samej miniatury — krótszy bok ma stałą długość.
      p.ratio = 1;
      var probe = new Image();
      probe.onload = function () {
        if (!probe.naturalWidth || !probe.naturalHeight) return;
        p.ratio = probe.naturalWidth / probe.naturalHeight;
        el.firstChild.style.setProperty("--r", p.ratio.toFixed(4));
        scheduleDeclutter();
      };
      probe.src = url(p.miniatura);
      el.title = p.opis ? p.opis.slice(0, 80) : p.id;
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", "Zdjęcie " + p.id);
      el.addEventListener("click", function (e) { e.stopPropagation(); onPinClick(p); });
      el.addEventListener("keydown", function (e) { if (e.key === "Enter") onPinClick(p); });
      p.marker = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]);
      p.onMap = false;
    });

    map.on("zoomend", function () {
      state.expandedId = state.currentPhoto ? state.currentPhoto.id : null;
      declutter();
    });
    map.on("click", function (e) {
      if (e.originalEvent && e.originalEvent.target.closest && e.originalEvent.target.closest(".md-marker")) return;
      if (state.expandedId && !state.currentPhoto) { state.expandedId = null; declutter(); }
    });
    map.on("resize", declutter);
    return new Promise(function (ok, fail) {
      map.once("load", ok);
      map.once("error", function (e) { if (!map.loaded()) fail(e.error || new Error("mapa")); });
    });
  }

  /* Zdjęcia zrobione w niemal tym samym miejscu rozsuwamy w kółko,
     żeby się nie zasłaniały (przeliczane przy każdym przybliżeniu). */
  var SAME_PLACE_M = 60; // zdjęcia bliżej niż tyle metrów traktujemy jako „to samo miejsce”
  var FAR_ZOOM = 13;     // poniżej tego przybliżenia miniatury są mniejsze

  function metres(a, b) {
    var dy = (a.lat - b.lat) * 111320;
    var dx = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* Miniatury, które na siebie zachodzą, tworzą „stos” z licznikiem.
     Kliknięcie w stos rozsuwa go w kółko. Zdjęcia z praktycznie tego samego miejsca
     są rozsunięte zawsze, a stos z otwartym zdjęciem zostaje rozsunięty, żeby dało się
     przeskakiwać między sąsiadami bez przybliżania. */
  function declutter() {
    var far = map.getZoom() < FAR_ZOOM;
    $(".md-map").classList.toggle("is-far", far);
    var s = far ? pinSize() * 0.6 : pinSize(), clusters = [];
    // rozmiar miniatury: krótszy bok = s, dłuższy zgodnie z proporcjami zdjęcia
    var size = function (p) { return { w: s * Math.max(p.ratio || 1, 1), h: s * Math.max(1 / (p.ratio || 1), 1) }; };
    var overlaps = function (a, b) {
      var sa = size(a.p), sb = size(b.p);
      return Math.abs(a.pt.x - b.pt.x) < (sa.w + sb.w) / 2 * 0.9 && Math.abs(a.pt.y - b.pt.y) < (sa.h + sb.h) / 2 * 0.9;
    };

    state.visible.forEach(function (p) {
      var pt = map.project([p.lon, p.lat]);
      var c = clusters.find(function (c) {
        return c.items.some(function (i) { return overlaps(i, { p: p, pt: pt }); });
      });
      if (c) c.items.push({ p: p, pt: pt });
      else clusters.push({ items: [{ p: p, pt: pt }] });
    });

    clusters.forEach(function (c) {
      var k = c.items.length;
      c.at = c.items.reduce(function (a, i) { return { x: a.x + i.pt.x / k, y: a.y + i.pt.y / k }; }, { x: 0, y: 0 });
      var samePlace = c.items.every(function (i) {
        return c.items.every(function (j) { return metres(i.p, j.p) < SAME_PLACE_M; });
      });
      c.expanded = k > 1 && (samePlace || c.items.some(function (i) { return i.p.id === state.expandedId; }));

      // kolejność na okręgu zgodna z kierunkiem od środka — sąsiedzi zostają sąsiadami
      c.items.sort(function (a, b) {
        return Math.atan2(a.pt.y - c.at.y, a.pt.x - c.at.x) - Math.atan2(b.pt.y - c.at.y, b.pt.x - c.at.x);
      });
      var L = Math.max.apply(null, c.items.map(function (i) { var z = size(i.p); return Math.max(z.w, z.h); }));
      var r = k > 1 ? Math.max(L * 0.8, (L + 8) / (2 * Math.sin(Math.PI / k))) : 0;

      c.items.forEach(function (it, i) {
        var dx = 0, dy = 0;
        if (c.expanded) {
          var a = -Math.PI / 2 + (2 * Math.PI * i) / k;
          dx = c.at.x + Math.cos(a) * r - it.pt.x;
          dy = c.at.y + Math.sin(a) * r - it.pt.y;
        }
        var el = it.p.marker.getElement(), pin = el.firstChild;
        it.p.cluster = c;
        pin.style.transform = "translate(" + Math.round(dx) + "px," + Math.round(dy) + "px)";
        pin.removeAttribute("data-count");
        el.style.zIndex = c.expanded ? 3 : "";
      });

      if (k > 1 && !c.expanded) {
        var top = c.items[k - 1];
        top.p.marker.getElement().firstChild.setAttribute("data-count", k);
        top.p.marker.getElement().style.zIndex = 2;
      }
    });
  }

  var declutterTimer;
  function scheduleDeclutter() {
    clearTimeout(declutterTimer);
    declutterTimer = setTimeout(function () { if (map) declutter(); }, 50);
  }

  function onPinClick(p) {
    var c = p.cluster;
    if (c && c.items.length > 1 && !c.expanded) {
      state.expandedId = p.id;   // pierwszy klik w stos — rozsuń
      declutter();
      return;
    }
    openViewer(state.visible.indexOf(p));
  }

  function boundsOf(list) {
    var b = new maplibregl.LngLatBounds();
    list.forEach(function (p) { b.extend([p.lon, p.lat]); });
    return b;
  }

  // ------------------------------------------------------------------ filtr
  function applyFilter(writeHash) {
    state.visible = state.photos.filter(function (p) {
      var show = matches(p);
      if (show && !p.onMap) { p.marker.addTo(map); p.onMap = true; }
      if (!show && p.onMap) { p.marker.remove(); p.onMap = false; }
      return show;
    });
    syncTagButtons();
    declutter();

    // Jeśli żadne z wybranych zdjęć nie jest w kadrze — pokaż je.
    var view = map.getBounds();
    if (writeHash !== false && state.visible.length &&
        !state.visible.some(function (p) { return view.contains([p.lon, p.lat]); })) {
      map.fitBounds(boundsOf(state.visible), { padding: 70, maxZoom: map.getZoom(), duration: 600 });
    }

    var total = state.photos.length;
    $(".md-count").textContent = "Widoczne: " + state.visible.length + " z " + total + " " +
      plural(total, "zdjęcia", "zdjęć", "zdjęć");

    var open = state.current >= 0 ? state.currentPhoto : null;
    if (open) {
      var i = state.visible.indexOf(open);
      if (i < 0) closeViewer(); else { state.current = i; updateNav(); }
    }
    if (writeHash !== false) writeHashNow();
  }

  function plural(n, one, few, many) {
    if (n === 1) return one;
    var d = n % 10, t = n % 100;
    return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
  }

  // ------------------------------------------------------------------ podgląd
  function openViewer(i) {
    if (i < 0 || i >= state.visible.length) return;
    var p = state.visible[i];
    if (state.currentPhoto && state.currentPhoto.marker && state.currentPhoto.marker.getElement()) {
      state.currentPhoto.marker.getElement().firstChild.classList.remove("is-active");
    }
    state.current = i;
    state.currentPhoto = p;
    state.expandedId = p.id;
    declutter();

    var v = $(".md-viewer");
    var img = v.querySelector("img");
    img.src = url(p.podglad);
    img.alt = p.opis || p.id;
    v.querySelector(".md-img-link").href = url(p.plik);
    v.querySelector(".md-viewer-tags").innerHTML = p.tagi.map(function (t) {
      return "<li" + tagStyle(t) + ">" + escapeHtml(tagName(t)) + "</li>";
    }).join("");
    v.querySelector(".md-desc").textContent = p.opis || "";
    v.querySelector(".md-meta").textContent = [p.data, p.lat.toFixed(5) + ", " + p.lon.toFixed(5)].filter(Boolean).join(" · ");
    v.hidden = false;
    updateNav();

    var el = p.marker.getElement();
    if (el) el.firstChild.classList.add("is-active");
    // Na komputerze przesuń mapę, jeśli zdjęcie chowa się pod panelem podglądu.
    // Bierzemy pod uwagę całe rozsunięte kółko, nie tylko klikniętą miniaturę.
    if (!mobile.matches) {
      var c = map.getContainer(), box = c.getBoundingClientRect();
      var group = p.cluster && p.cluster.expanded ? p.cluster.items.map(function (i) { return i.p; }) : [p];
      var hidden = group.some(function (q) {
        var r = q.marker.getElement().firstChild.getBoundingClientRect();
        return r.right > box.left + c.clientWidth - v.offsetWidth - 16 || r.left < box.left + 16 ||
               r.top < box.top + 16 || r.bottom > box.top + c.clientHeight - 16;
      });
      if (hidden) {
        var centre = p.cluster && p.cluster.expanded ? map.unproject([p.cluster.at.x, p.cluster.at.y]) : [p.lon, p.lat];
        map.easeTo({ center: centre, offset: [-v.offsetWidth / 2, 0], duration: 400 });
      }
    }
    writeHashNow();
  }

  function updateNav() {
    $(".md-pos").textContent = (state.current + 1) + " / " + state.visible.length;
    $('[data-step="-1"]').disabled = state.current <= 0;
    $('[data-step="1"]').disabled = state.current >= state.visible.length - 1;
  }

  function closeViewer() {
    $(".md-viewer").hidden = true;
    if (state.currentPhoto) {
      state.currentPhoto.marker.getElement().firstChild.classList.remove("is-active");
    }
    state.current = -1;
    state.currentPhoto = null;
    state.expandedId = null;
    declutter();
    writeHashNow();
  }

  // ------------------------------------------------------------------ adres (#foto=…)
  function writeHashNow() {
    var parts = [];
    if (state.currentPhoto) parts.push("foto=" + encodeURIComponent(state.currentPhoto.id));
    var h = parts.length ? "#" + parts.join("&") : "";
    if (h !== location.hash) history.replaceState(null, "", h || location.pathname + location.search);
  }

  function readHash() {
    var q = {};
    location.hash.replace(/^#/, "").split("&").forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i > 0) q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    if (q.foto) state.pendingPhoto = state.photos.find(function (p) { return p.id === q.foto; });
  }

  // ------------------------------------------------------------------ zdarzenia
  function bindUi() {
    $(".md-tags").addEventListener("click", function (e) {
      var b = e.target.closest(".md-tag");
      if (!b) return;
      var t = b.getAttribute("data-tag");
      if (state.selected.has(t)) state.selected.delete(t); else state.selected.add(t);
      applyFilter();
    });
    $(".md-mode").addEventListener("click", function (e) {
      var b = e.target.closest("[data-mode]");
      if (!b) return;
      state.mode = b.getAttribute("data-mode");
      applyFilter();
    });
    $(".md-actions").addEventListener("click", function (e) {
      var act = e.target.getAttribute("data-act");
      if (act === "all") state.selected = new Set(state.tagOrder);
      else if (act === "none") state.selected = new Set();
      else return;
      applyFilter();
    });
    $(".md-close").addEventListener("click", closeViewer);
    $(".md-nav").addEventListener("click", function (e) {
      var b = e.target.closest("[data-step]");
      if (b && !b.disabled) openViewer(state.current + Number(b.getAttribute("data-step")));
    });
    document.addEventListener("keydown", function (e) {
      if ($(".md-viewer").hidden) return;
      if (e.key === "Escape") closeViewer();
      else if (e.key === "ArrowLeft") openViewer(state.current - 1);
      else if (e.key === "ArrowRight") openViewer(state.current + 1);
    });

    var toggle = $(".md-toggle"), filters = $(".md-filters");
    function setFilters(open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      filters.hidden = !open;
      setTimeout(function () { map.resize(); }, 0);
    }
    toggle.addEventListener("click", function () { setFilters(filters.hidden); });
    if (mobile.matches) setFilters(false);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
})();
