// ── Bouncer Custom SVG Charts ──────────────────────────
// Ported from UsageTracker Svelte components to vanilla JS
(function () {
  "use strict";

  // ── Shared tooltip ──
  let tooltip = null;

  function ensureTooltip() {
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "chart-tooltip";
      document.body.appendChild(tooltip);
    }
    return tooltip;
  }

  function hideTooltip() {
    if (tooltip) tooltip.style.display = "none";
  }

  function showTooltip(html, x, y) {
    const t = ensureTooltip();
    t.innerHTML = html;
    t.style.display = "block";
    t.style.left = x + 12 + "px";
    t.style.top = y + "px";
    t.style.transform = "translateY(-50%)";
    requestAnimationFrame(() => {
      const r = t.getBoundingClientRect();
      if (r.right > window.innerWidth) t.style.left = x - r.width - 12 + "px";
      if (r.bottom > window.innerHeight) {
        t.style.top = window.innerHeight - r.height - 8 + "px";
        t.style.transform = "none";
      }
    });
  }

  window.addEventListener("scroll", hideTooltip, true);

  // ── Formatting ──
  function cfmt(n) {
    if (typeof n !== "number" || isNaN(n)) return "-";
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  function cfmtFull(n) {
    return typeof n === "number" ? n.toLocaleString() : "-";
  }

  // ── Grid Line Calculation (from UsageTracker) ──
  function calcGridLines(maxVal) {
    if (maxVal === 0) return [0];
    if (maxVal < 1) return [maxVal];

    const exp = Math.floor(Math.log10(maxVal));
    const m = maxVal / Math.pow(10, exp);

    let interval;
    if (m <= 2) interval = Math.pow(10, exp);
    else if (m <= 5) interval = 2 * Math.pow(10, exp);
    else interval = 5 * Math.pow(10, exp);

    const lines = [];
    let c = 1;
    while (true) {
      const v = interval * c;
      if (v >= maxVal) break;
      lines.push(Math.round(v * 1e10) / 1e10);
      c++;
    }

    if (lines.length < 2) {
      lines.length = 0;
      c = 1;
      while (true) {
        const v = (interval / 2) * c;
        if (v >= maxVal) break;
        lines.push(Math.round(v * 1e10) / 1e10);
        c++;
      }
    }
    return lines;
  }

  // ── Colors ──
  const BAR_COLORS = {
    cached: "#4fc3f7",
    prompt: "#5b6aff",
    completion: "#ff6b6b",
    cost: "#5b6aff",
    requests: "#69db7c",
  };
  const DONUT_COLORS = [
    "#5b6aff",
    "#8b5cf6",
    "#f97316",
    "#10b981",
    "#ef4444",
    "#eab308",
    "#ec4899",
    "#06b6d4",
  ];

  // ═════════════════════════════════════════════════════
  //  BAR CHART
  // ═════════════════════════════════════════════════════
  window.renderBarChart = function (containerId, labels, srcData, metricType) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    const H = 200,
      BAR_W = 32,
      GAP = 26,
      YAX_W = 50,
      BOT = 28,
      R_PAD = 16;
    const isTokens = metricType === "tokens";

    // max value
    let maxVal = 0;
    srcData.forEach((d) => {
      let v;
      if (isTokens)
        v =
          (d.total_prompt || 0) +
          (d.total_completion || 0) +
          (d.total_cached || 0);
      else if (metricType === "cost") v = d.total_cost || 0;
      else v = d.total_requests || 0;
      maxVal = Math.max(maxVal, v);
    });
    maxVal = maxVal === 0 ? 1 : maxVal * 1.05;

    const grid = calcGridLines(maxVal);
    const cW = srcData.length * (BAR_W + GAP) + GAP;
    const svgH = H + BOT;
    const scrollAvailableW = Math.max(0, container.clientWidth - YAX_W);
    const svgW = Math.max(cW + R_PAD, scrollAvailableW);

    // wrapper
    const wrap = document.createElement("div");
    wrap.className = "svg-bar-wrap";

    // Y-axis
    const yDiv = document.createElement("div");
    yDiv.className = "svg-bar-yaxis";
    let yS = `<svg width="${YAX_W}" height="${svgH}">`;
    grid.forEach((v) => {
      const y = H - (v / maxVal) * H;
      yS += `<text x="${YAX_W - 6}" y="${y + 4}" fill="#999" font-size="10" font-family="inherit" text-anchor="end">${cfmt(v)}</text>`;
    });
    yS += `</svg>`;
    yDiv.innerHTML = yS;

    // scrollable chart
    const scrollDiv = document.createElement("div");
    scrollDiv.className = "svg-bar-scroll";

    let s = `<svg width="${svgW}" height="${svgH}">`;

    // grid lines
    grid.forEach((v) => {
      const y = H - (v / maxVal) * H;
      s += `<line x1="0" y1="${y}" x2="${svgW}" y2="${y}" stroke="#e2e6ea" stroke-width="1" stroke-dasharray="3,3"/>`;
    });
    s += `<line x1="0" y1="${H}" x2="${svgW}" y2="${H}" stroke="#ddd" stroke-width="1.5"/>`;

    // bars
    srcData.forEach((d, i) => {
      const x = GAP + i * (BAR_W + GAP);

      if (isTokens) {
        const cv = d.total_cached || 0,
          pv = d.total_prompt || 0,
          ov = d.total_completion || 0;
        const cH = (cv / maxVal) * H,
          pH = (pv / maxVal) * H,
          oH = (ov / maxVal) * H;
        const cY = H - cH,
          pY = cY - pH,
          oY = pY - oH;
        if (oH > 0.5)
          s += `<rect x="${x}" y="${oY}" width="${BAR_W}" height="${oH}" fill="${BAR_COLORS.completion}" rx="2" opacity="0.85"/>`;
        if (pH > 0.5)
          s += `<rect x="${x}" y="${pY}" width="${BAR_W}" height="${pH}" fill="${BAR_COLORS.prompt}" rx="2" opacity="0.85"/>`;
        if (cH > 0.5)
          s += `<rect x="${x}" y="${cY}" width="${BAR_W}" height="${cH}" fill="${BAR_COLORS.cached}" rx="2" opacity="0.85"/>`;
      } else {
        const val =
          metricType === "cost" ? d.total_cost || 0 : d.total_requests || 0;
        const h = (val / maxVal) * H,
          y = H - h;
        const color = BAR_COLORS[metricType] || BAR_COLORS.cost;
        if (h > 0.5)
          s += `<rect x="${x}" y="${y}" width="${BAR_W}" height="${h}" fill="${color}" rx="2" opacity="0.85"/>`;
      }

      // hover hitbox
      s += `<rect data-idx="${i}" x="${x}" y="0" width="${BAR_W}" height="${H}" fill="transparent" style="cursor:pointer" class="bar-hit"/>`;
      // x label
      s += `<text x="${x + BAR_W / 2}" y="${H + 16}" fill="#999" font-size="10" font-family="inherit" text-anchor="middle">${labels[i]}</text>`;
    });

    s += `</svg>`;
    scrollDiv.innerHTML = s;

    wrap.appendChild(yDiv);
    wrap.appendChild(scrollDiv);
    container.appendChild(wrap);

    // legend
    const leg = document.createElement("div");
    leg.className = "svg-chart-legend";
    if (isTokens) {
      leg.innerHTML = `
        <span class="legend-item"><span class="legend-dot" style="background:${BAR_COLORS.cached}"></span>캐시</span>
        <span class="legend-item"><span class="legend-dot" style="background:${BAR_COLORS.prompt}"></span>입력</span>
        <span class="legend-item"><span class="legend-dot" style="background:${BAR_COLORS.completion}"></span>출력</span>`;
    } else if (metricType === "cost") {
      leg.innerHTML = `<span class="legend-item"><span class="legend-dot" style="background:${BAR_COLORS.cost}"></span>크레딧</span>`;
    } else {
      leg.innerHTML = `<span class="legend-item"><span class="legend-dot" style="background:${BAR_COLORS.requests}"></span>호출수</span>`;
    }
    container.appendChild(leg);

    // scroll to end
    requestAnimationFrame(() => {
      scrollDiv.scrollLeft = scrollDiv.scrollWidth - scrollDiv.clientWidth;
    });

    // tooltip events
    scrollDiv.querySelectorAll(".bar-hit").forEach((rect) => {
      const idx = +rect.getAttribute("data-idx");
      const d = srcData[idx];
      rect.addEventListener("mouseenter", (e) => {
        showTooltip(
          `<div class="tt-title">${labels[idx]}</div>
           <div class="tt-row">요청: ${cfmtFull(d.total_requests)}</div>
           <div class="tt-row">입력: ${cfmtFull(d.total_prompt)}</div>
           <div class="tt-row">출력: ${cfmtFull(d.total_completion)}</div>
           <div class="tt-row">캐시: ${cfmtFull(d.total_cached)}</div>
           <div class="tt-row">비용: ${cfmtFull(d.total_cost)}</div>`,
          e.clientX,
          e.clientY,
        );
      });
      rect.addEventListener("mousemove", (e) => {
        if (tooltip && tooltip.style.display !== "none")
          showTooltip(tooltip.innerHTML, e.clientX, e.clientY);
      });
      rect.addEventListener("mouseleave", hideTooltip);
    });
  };

  // ═════════════════════════════════════════════════════
  //  DONUT CHART
  // ═════════════════════════════════════════════════════
  function donutPath(cx, r, ir, startAngle, angle) {
    if (angle >= 359.9) {
      const midA = startAngle + 180;
      const sR = (startAngle * Math.PI) / 180,
        mR = (midA * Math.PI) / 180;
      const x1 = cx + r * Math.cos(sR),
        y1 = cx + r * Math.sin(sR);
      const x2 = cx + r * Math.cos(mR),
        y2 = cx + r * Math.sin(mR);
      const x3 = cx + ir * Math.cos(mR),
        y3 = cx + ir * Math.sin(mR);
      const x4 = cx + ir * Math.cos(sR),
        y4 = cx + ir * Math.sin(sR);
      return `M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2} A ${r} ${r} 0 1 1 ${x1} ${y1} Z M ${x4} ${y4} A ${ir} ${ir} 0 1 0 ${x3} ${y3} A ${ir} ${ir} 0 1 0 ${x4} ${y4} Z`;
    }
    const sR = (startAngle * Math.PI) / 180,
      eR = ((startAngle + angle) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(sR),
      y1 = cx + r * Math.sin(sR);
    const x2 = cx + r * Math.cos(eR),
      y2 = cx + r * Math.sin(eR);
    const x3 = cx + ir * Math.cos(eR),
      y3 = cx + ir * Math.sin(eR);
    const x4 = cx + ir * Math.cos(sR),
      y4 = cx + ir * Math.sin(sR);
    const la = angle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${la} 1 ${x2} ${y2} L ${x3} ${y3} A ${ir} ${ir} 0 ${la} 0 ${x4} ${y4} Z`;
  }

  window.renderDonutChart = function (containerId, modelData, metricType) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    if (!modelData || modelData.length === 0) return;

    const SIZE = 180,
      CX = SIZE / 2,
      R = 70,
      IR = 44;

    const getVal = (m) => {
      if (metricType === "cost") return m.total_cost || 0;
      if (metricType === "requests") return m.total_requests || 0;
      return (
        m.total_tokens ||
        (m.total_prompt || 0) +
          (m.total_completion || 0) +
          (m.total_cached || 0)
      );
    };

    const total = modelData.reduce((s, m) => s + getVal(m), 0);
    if (total === 0) return;

    const items = modelData.slice(0, 7).map((m, i) => ({
      name: m.model_name,
      value: getVal(m),
      pct: (getVal(m) / total) * 100,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
    }));
    if (modelData.length > 7) {
      const rest = modelData.slice(7).reduce((s, m) => s + getVal(m), 0);
      if (rest > 0)
        items.push({
          name: "기타",
          value: rest,
          pct: (rest / total) * 100,
          color: "#9ca3af",
        });
    }

    // layout
    const flex = document.createElement("div");
    flex.className = "donut-layout";

    // SVG
    const svgWrap = document.createElement("div");
    svgWrap.className = "donut-svg-wrap";
    let svg = `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`;

    let startA = -90;
    items.forEach((it, i) => {
      const angle = (it.pct / 100) * 360;
      if (angle < 0.5) {
        startA += angle;
        return;
      }
      svg += `<path d="${donutPath(CX, R, IR, startA, angle)}" fill="${it.color}" opacity="0.88" class="donut-seg" data-idx="${i}" style="cursor:pointer"/>`;
      startA += angle;
    });
    svg += `</svg>`;
    svgWrap.innerHTML = svg;

    // legend table
    const legDiv = document.createElement("div");
    legDiv.className = "donut-legend";
    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "donut-legend-row";
      const displayName =
        it.name.length > 22 ? it.name.slice(0, 22) + "…" : it.name;
      row.innerHTML = `<span class="legend-dot" style="background:${it.color}"></span><span class="donut-legend-name" title="${it.name}">${displayName}</span><span class="donut-legend-right"><span class="donut-legend-pct">${it.pct.toFixed(1)}%</span> <strong>${cfmt(it.value)}</strong></span>`;
      legDiv.appendChild(row);
    });

    flex.appendChild(svgWrap);
    flex.appendChild(legDiv);
    container.appendChild(flex);

    // tooltip
    svgWrap.querySelectorAll(".donut-seg").forEach((seg) => {
      const idx = +seg.getAttribute("data-idx");
      const it = items[idx];
      seg.addEventListener("mouseenter", (e) => {
        seg.setAttribute("opacity", "1");
        showTooltip(
          `<div class="tt-title">${it.name}</div><div class="tt-row">${it.pct.toFixed(1)}% · ${cfmtFull(it.value)}</div>`,
          e.clientX,
          e.clientY,
        );
      });
      seg.addEventListener("mousemove", (e) =>
        showTooltip(tooltip.innerHTML, e.clientX, e.clientY),
      );
      seg.addEventListener("mouseleave", () => {
        seg.setAttribute("opacity", "0.88");
        hideTooltip();
      });
    });
  };

  // ═════════════════════════════════════════════════════
  //  CLEAR CHART
  // ═════════════════════════════════════════════════════
  window.clearChart = function (containerId) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = "";
  };
})();
