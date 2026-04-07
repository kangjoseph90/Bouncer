// ── 상수 & 상태 ──────────────────────────────────────────────────
const API_KEY_STORAGE = "bouncer_api_key";
const ADMIN_TOKEN_STORAGE = "bouncer_admin_pw";
let currentApiKey = "",
  currentAdminPw = "",
  currentTempToken = "";
let tokenTimerInterval = null;
let currentDashDaily = [];
let currentSvDaily = [];
let currentDashModel = [];
let currentSvModel = [];
let adminUserState = {};

// ── 유틸 ────────────────────────────────────────────────────────
function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtNum(n) {
  return typeof n === "number" ? n.toLocaleString() : "-";
}
function fmtDate(ts) {
  return new Date(ts).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function limitStr(name, max = 14) {
  return name.length > max ? name.slice(0, max) + "…" : name;
}

function getArcaProfile(arcaId, displayName) {
  if (!arcaId) return { text: "-", url: "#" };
  if (arcaId.startsWith("fixed_")) {
    const nm = displayName || arcaId.replace("fixed_", "");
    return {
      text: `@${escapeHTML(nm)}`,
      url: `https://arca.live/u/@${encodeURIComponent(nm)}`,
    };
  }
  if (arcaId.startsWith("half_")) {
    const num = arcaId.replace("half_", "");
    return {
      text: `@${escapeHTML(displayName)}#${escapeHTML(num)}`,
      url: `https://arca.live/u/@${encodeURIComponent(displayName)}/${num}`,
    };
  }
  return { text: escapeHTML(arcaId), url: "#" };
}

function getTimeRangeText(res) {
  if (res === "1d") return "(최근 30일)";
  if (res === "1h") return "(최근 2일)";
  if (res === "15m") return "(최근 12시간)";
  if (res === "5m") return "(최근 4시간)";
  return "";
}

function formatChartLabel(dateStr, res) {
  if (res === "1d") {
    // 2026-03-31 -> 03/31
    return dateStr.slice(5, 7) + "/" + dateStr.slice(8, 10);
  }
  // 2026-03-31 12:00:00 -> 12:00
  return dateStr.slice(11, 16);
}

// 빈 시간 슬롯을 0으로 채우는 함수 (데이터 범위 주변만)
function fillEmptySlots(dailyData, res) {
  const now = new Date();
  const slots = [];
  const dataMap = new Map(dailyData.map((d) => [d.date, d]));

  const pad = (n) => String(n).padStart(2, "0");
  const formatLocalDate = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // YYYY-MM-DD

  let intervalMs, count, formatFn;

  if (res === "1d") {
    intervalMs = 24 * 60 * 60 * 1000;
    count = 30;
    formatFn = formatLocalDate;
  } else if (res === "1h") {
    intervalMs = 60 * 60 * 1000;
    count = 48;
    formatFn = (d) => formatLocalDate(d) + ` ${pad(d.getHours())}:00:00`;
  } else if (res === "15m") {
    intervalMs = 15 * 60 * 1000;
    count = 48;
    formatFn = (d) =>
      formatLocalDate(d) + ` ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  } else if (res === "5m") {
    intervalMs = 5 * 60 * 1000;
    count = 48;
    formatFn = (d) =>
      formatLocalDate(d) + ` ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  } else {
    return {
      labels: dailyData.map((d) => formatChartLabel(d.date, res)),
      filledData: dailyData,
    };
  }

  // 현재 시간을 해당 해상도에 맞게 내림
  let cursor = new Date(Math.floor(now.getTime() / intervalMs) * intervalMs);

  for (let i = 0; i < count; i++) {
    const dateStr = formatFn(cursor);
    const existing = dataMap.get(dateStr);

    if (existing) {
      slots.unshift({ date: dateStr, ...existing });
    } else {
      slots.unshift({
        date: dateStr,
        total_requests: 0,
        total_prompt: 0,
        total_completion: 0,
        total_cached: 0,
        total_cost: 0,
      });
    }
    cursor = new Date(cursor.getTime() - intervalMs);
  }

  return {
    labels: slots.map((s) => formatChartLabel(s.date, res)),
    filledData: slots,
  };
}

// ── 탭 네비게이션 ────────────────────────────────────────────────
function navigate(tabId) {
  document
    .querySelectorAll(".view-section")
    .forEach((el) => el.classList.add("hidden"));
  document
    .querySelectorAll(".nav-links a")
    .forEach((el) => el.classList.remove("active"));
  document.getElementById(`view-${tabId}`).classList.remove("hidden");
  document.getElementById(`nav-${tabId}`).classList.add("active");
  if (tabId === "dashboard") checkAuthOnLoad();
  else if (tabId === "status") fetchStatus();
  else if (tabId === "admin") checkAdminAuthOnLoad();
  else if (tabId === "issue") checkSetupStatus();
  else if (tabId === "docs") fetchDocs();
}

// ── 초기화 ─────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const origin = window.location.origin;
  document.getElementById("display-base-url").innerText = `${origin}/v1`;
  document.getElementById("curl-example").innerText =
    `curl -X POST ${origin}/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer bnc-your_key" \\\n  -d '{"model":"openai/gpt-5.4","messages":[{"role":"user","content":"안녕!"}]}'`;
  checkSetupStatus();
});

async function checkSetupStatus() {
  try {
    const res = await fetch("/api/auth/token");
    const data = await res.json();
    const warn = document.getElementById("setup-warning");
    const btn = document.getElementById("btn-get-token");
    if (!data.success && data.error.includes("ARCA_POST_URL")) {
      warn.classList.remove("hidden");
      btn.disabled = true;
    } else {
      warn.classList.add("hidden");
      btn.disabled = false;
    }
  } catch (e) {}
}

// ── TAB 1: 키 발급 ───────────────────────────────────────────────
async function getToken() {
  const btn = document.getElementById("btn-get-token");
  btn.disabled = true;
  btn.innerText = "발급 중...";
  try {
    const res = await fetch("/api/auth/token");
    const data = await res.json();
    if (data.success) {
      currentTempToken = data.token;
      document.getElementById("token-text").innerText = data.token;
      document.getElementById("auth-link").href = data.postUrl;
      document.getElementById("token-display").classList.remove("hidden");
      btn.classList.add("hidden");
      if (tokenTimerInterval) clearInterval(tokenTimerInterval);
      let ms = data.expiresIn;
      const tick = () => {
        if (ms <= 0) {
          document.getElementById("token-timer").innerText = "만료됨";
          clearInterval(tokenTimerInterval);
          return;
        }
        const m = Math.floor(ms / 60000),
          s = Math.floor((ms % 60000) / 1000);
        document.getElementById("token-timer").innerText =
          `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        ms -= 1000;
      };
      tick();
      tokenTimerInterval = setInterval(tick, 1000);
    } else {
      alert("발급 실패: " + data.error);
      btn.disabled = false;
      btn.innerText = "인증 시작하기";
    }
  } catch (e) {
    alert("서버에 연결할 수 없습니다.");
    btn.disabled = false;
    btn.innerText = "인증 시작하기";
  }
}

async function verifyToken() {
  if (!currentTempToken) return;
  const btn = document.getElementById("btn-verify");
  btn.disabled = true;
  btn.innerText = "확인 중...";
  try {
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: currentTempToken }),
    });
    const data = await res.json();
    if (data.success) {
      if (tokenTimerInterval) clearInterval(tokenTimerInterval);
      currentApiKey = data.data.apiKey;
      document.getElementById("new-api-key").innerText = currentApiKey;
      document.getElementById("state-auth").classList.add("hidden");
      document.getElementById("state-success").classList.remove("hidden");
    } else {
      alert("인증 거부: " + data.error);
      btn.disabled = false;
      btn.innerText = "댓글 작성 완료 (인증 확인)";
    }
  } catch (e) {
    alert("서버 오류");
    btn.disabled = false;
    btn.innerText = "댓글 작성 완료 (인증 확인)";
  }
}

function saveAndGoDashboard() {
  localStorage.setItem(API_KEY_STORAGE, currentApiKey);
  document.getElementById("state-auth").classList.remove("hidden");
  document.getElementById("state-success").classList.add("hidden");
  document.getElementById("token-display").classList.add("hidden");
  const btn = document.getElementById("btn-get-token");
  btn.classList.remove("hidden");
  btn.disabled = false;
  btn.innerText = "인증 시작하기";
  document.getElementById("btn-verify").disabled = false;
  document.getElementById("btn-verify").innerText =
    "댓글 작성 완료 (인증 확인)";
  currentTempToken = "";
  navigate("dashboard");
}

// ── TAB 2: 대시보드 ─────────────────────────────────────────────
function checkAuthOnLoad() {
  const key = localStorage.getItem(API_KEY_STORAGE);
  if (key) {
    currentApiKey = key;
    fetchDashboardContent();
  } else {
    document.getElementById("dash-login").classList.remove("hidden");
    document.getElementById("dash-stats").classList.add("hidden");
  }
}

function loginDashboard() {
  const k = document.getElementById("login-api-key").value.trim();
  if (!k) {
    alert("API 키를 입력해주세요.");
    return;
  }
  currentApiKey = k;
  if (document.getElementById("check-remember").checked)
    localStorage.setItem(API_KEY_STORAGE, k);
  else localStorage.removeItem(API_KEY_STORAGE);
  fetchDashboardContent();
}

function logoutDashboard() {
  localStorage.removeItem(API_KEY_STORAGE);
  currentApiKey = "";
  checkAuthOnLoad();
}

async function fetchDashboardContent() {
  const resType = document.getElementById("dash-res-select").value;
  try {
    const [baseRes, statsRes] = await Promise.all([
      fetch("/api/dashboard", {
        headers: { Authorization: `Bearer ${currentApiKey}` },
      }),
      fetch(`/api/stats/user/usage?res=${resType}`, {
        headers: { Authorization: `Bearer ${currentApiKey}` },
      }),
    ]);
    const base = await baseRes.json();
    if (!base.success) {
      alert("조회 실패: " + base.error);
      logoutDashboard();
      return;
    }

    const p = getArcaProfile(base.data.arcaId, base.data.displayName);
    const link = document.getElementById("dash-arcaid");
    link.href = p.url;
    link.innerText = p.text;
    document.getElementById("dash-quota").innerText = fmtNum(
      base.data.creditBalance,
    );
    const badge = document.getElementById("dash-status-badge");
    badge.innerText = base.data.status.toUpperCase();
    badge.className =
      "badge " +
      (base.data.status === "active"
        ? "badge-active"
        : base.data.status === "suspended"
          ? "badge-suspended"
          : "badge-revoked");

    document.getElementById("dash-login").classList.add("hidden");
    document.getElementById("dash-stats").classList.remove("hidden");

    if (statsRes.ok) {
      const stats = await statsRes.json();
      if (stats.success) {
        if (stats.lastUpdatedAt) {
          document.getElementById("dash-last-updated").innerText =
            "마지막 업데이트: " +
            new Date(stats.lastUpdatedAt).toLocaleTimeString("ko-KR", {
              hour12: false,
            });
        }
        const { daily, byModel, recentLogs, totals } = stats.data;
        document.getElementById("dash-7d-req").innerText = fmtNum(
          totals.totalRequests,
        );
        document.getElementById("dash-7d-cost").innerText = fmtNum(
          totals.totalCost,
        );

        currentDashDaily = daily;
        currentDashModel = byModel;
        updateDashChartType();

        const tbody = document.getElementById("dash-log-body");
        tbody.innerHTML = "";
        if (recentLogs.length === 0) {
          tbody.innerHTML =
            '<tr><td colspan="6" style="text-align:center;color:var(--muted)">사용 기록이 없습니다.</td></tr>';
        } else {
          recentLogs.forEach((l) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td>${fmtDate(l.created_at)}</td><td>${escapeHTML(limitStr(l.model_name, 18))}</td><td>${fmtNum(l.tokens_prompt)}</td><td>${fmtNum(l.tokens_completion)}</td><td>${fmtNum(l.tokens_cached)}</td><td><strong>${fmtNum(l.cost)}</strong></td>`;
            tbody.appendChild(tr);
          });
        }
      }
    }
  } catch (e) {
    alert("서버 통신 오류");
    logoutDashboard();
  }
}

function updateDashChartType() {
  const metric = document.getElementById("dash-metric-select").value;
  const res = document.getElementById("dash-res-select").value;

  const trange = document.getElementById("dash-time-range");
  if (trange) trange.innerText = getTimeRangeText(res);

  clearChart("dash-daily-chart");
  clearChart("dash-model-chart");

  const dailyEmpty = document.getElementById("dash-daily-empty");
  const modelEmpty = document.getElementById("dash-model-empty");

  if (currentDashDaily.length > 0) {
    if (dailyEmpty) dailyEmpty.style.display = "none";
    const { labels, filledData } = fillEmptySlots(currentDashDaily, res);
    renderBarChart("dash-daily-chart", labels, filledData, metric);
  } else {
    if (dailyEmpty) dailyEmpty.style.display = "flex";
  }

  if (currentDashModel.length > 0) {
    if (modelEmpty) modelEmpty.style.display = "none";
    renderDonutChart("dash-model-chart", currentDashModel, metric);
  } else {
    if (modelEmpty) modelEmpty.style.display = "flex";
  }
}

async function refreshAdminUserCharts(arcaId) {
  const safe = arcaId.replace(/[^a-z0-9_]/gi, "_");
  const metric = document.getElementById(`adm-metric-${safe}`).value;
  const res = document.getElementById(`adm-res-${safe}`).value;

  try {
    const req = await fetch(`/api/admin/stats/user/${arcaId}?res=${res}`, {
      headers: { Authorization: `Admin ${currentAdminPw}` },
    });
    const body = await req.json();
    if (body.success) {
      const state = adminUserState[safe] || {};
      state.currentDaily = body.data.daily;
      state.currentModel = body.data.byModel;
      adminUserState[safe] = state;
      updateAdminChartRender(safe, metric, res);

      if (body.lastUpdatedAt) {
        document.getElementById(`stats-time-${arcaId}`).innerText =
          "마지막 업데이트: " +
          new Date(body.lastUpdatedAt).toLocaleTimeString("ko-KR", {
            hour12: false,
          });
      }
    }
  } catch (e) {}
}

function updateAdminChartRender(safe, metric, res) {
  const state = adminUserState[safe];
  if (!state) return;

  clearChart(`adm-daily-${safe}`);
  clearChart(`adm-model-${safe}`);

  const dailyEmpty = document.getElementById(`adm-daily-empty-${safe}`);
  const modelEmpty = document.getElementById(`adm-model-empty-${safe}`);

  if (state.currentDaily && state.currentDaily.length > 0) {
    if (dailyEmpty) dailyEmpty.style.display = "none";
    const { labels, filledData } = fillEmptySlots(state.currentDaily, res);
    renderBarChart(`adm-daily-${safe}`, labels, filledData, metric);
  } else {
    if (dailyEmpty) dailyEmpty.style.display = "flex";
  }

  if (state.currentModel && state.currentModel.length > 0) {
    if (modelEmpty) modelEmpty.style.display = "none";
    renderDonutChart(`adm-model-${safe}`, state.currentModel, metric);
  } else {
    if (modelEmpty) modelEmpty.style.display = "flex";
  }
}

function updateAdminMetricOnly(arcaId) {
  const safe = arcaId.replace(/[^a-z0-9_]/gi, "_");
  const metric = document.getElementById(`adm-metric-${safe}`).value;
  const res = document.getElementById(`adm-res-${safe}`).value;
  updateAdminChartRender(safe, metric, res);
}

async function revokeCurrentKey() {
  if (
    !confirm(
      "정말 API 키를 영구 파기하시겠습니까?\n모든 클라이언트 연결이 즉시 끊어집니다!",
    )
  )
    return;
  try {
    const res = await fetch("/api/revoke", {
      method: "POST",
      headers: { Authorization: `Bearer ${currentApiKey}` },
    });
    const body = await res.json();
    if (body.success) {
      alert(body.message);
      logoutDashboard();
    } else alert("파기 실패: " + body.error);
  } catch (e) {
    alert("서버 통신 오류");
  }
}

// ── TAB 3: 가이드 ────────────────────────────────────────────────
async function fetchDocs() {
  try {
    const res = await fetch("/api/stats/models");
    const data = await res.json();
    const tbody = document.getElementById("model-catalog-body");
    tbody.innerHTML = "";
    if (!data.success || !data.data.length) {
      tbody.innerHTML =
        '<tr><td colspan="8" style="text-align:center;color:var(--muted)">모델 없음</td></tr>';
      return;
    }
    data.data.forEach((m) => {
      const billingBadge =
        m.billingType === "token"
          ? '<span class="badge badge-token">토큰</span>'
          : '<span class="badge badge-request">횟수</span>';
      const statusBadge = m.active
        ? '<span class="badge badge-active">활성</span>'
        : '<span class="badge badge-suspended">비활성</span>';
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><code style="font-size:12px">${m.id}</code></td>
        <td>${billingBadge}</td>
        <td>${m.billingType === "request" ? fmtNum(m.cost.request) : "-"}</td>
        <td>${m.billingType === "token" ? (m.cost.prompt ?? "-") : "-"}</td>
        <td>${m.billingType === "token" ? (m.cost.completion ?? "-") : "-"}</td>
        <td>${m.billingType === "token" ? (m.cost.cached ?? "-") : "-"}</td>
        <td>${m.concurrency}</td>
        <td>${statusBadge}</td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    document.getElementById("model-catalog-body").innerHTML =
      '<tr><td colspan="8" style="text-align:center;color:var(--danger)">로드 실패</td></tr>';
  }
}

// ── TAB 4: 서버 통계 ─────────────────────────────────────────────
async function fetchStatus() {
  const resType = document.getElementById("sv-res-select").value;
  try {
    const [serverRes, usageRes] = await Promise.all([
      fetch("/api/stats/server"),
      fetch(`/api/stats/server/usage?res=${resType}`),
    ]);
    const sv = await serverRes.json();
    const usage = await usageRes.json();

    if (sv.success) {
      const d = sv.data;
      if (sv.lastUpdatedAt) {
        document.getElementById("sv-last-updated").innerText =
          "마지막 업데이트: " +
          new Date(sv.lastUpdatedAt).toLocaleTimeString("ko-KR", {
            hour12: false,
          });
      }
      document.getElementById("sv-total-users").innerText = fmtNum(
        d.users.total,
      );
      document.getElementById("sv-active-users").innerText = fmtNum(
        d.users.active24h,
      );
      document.getElementById("sv-status").innerText = "ONLINE";

      const refillLabel = {
        none: "없음",
        daily: "매일",
        monthly: "매월",
      };
      document.getElementById("sv-refill").innerText =
        refillLabel[d.globalQuota.refillMode] || "-";

      const quotaSec = document.getElementById("sv-quota-section");
      if (d.globalQuota.limit !== null) {
        quotaSec.classList.remove("hidden");
        const pct = Math.min(
          100,
          Math.round((d.globalQuota.used / d.globalQuota.limit) * 100),
        );
        document.getElementById("sv-quota-text").innerText =
          `${fmtNum(d.globalQuota.used)} / ${fmtNum(d.globalQuota.limit)} (${pct}%)`;
        document.getElementById("sv-quota-bar").style.width = pct + "%";
        document.getElementById("sv-quota-bar").style.background =
          pct > 85
            ? "var(--danger)"
            : pct > 60
              ? "var(--warning)"
              : "var(--accent)";
        if (d.globalQuota.lastRefilledAt) {
          document.getElementById("sv-quota-refill-ts").innerText =
            "마지막 리필: " + fmtDate(d.globalQuota.lastRefilledAt);
        }
      } else {
        document.getElementById("sv-quota-text").innerText = "무제한";
        document.getElementById("sv-quota-bar").style.width = "0%";
      }

      function limRow(label, val) {
        return `<tr><td style="color:var(--muted);font-size:13px">${label}</td><td style="text-align:right;font-weight:600;font-size:13px">${val === null ? "∞" : fmtNum(val)}</td></tr>`;
      }
      const gl = d.limits.global,
        ul = d.limits.perUser;
      document
        .getElementById("sv-global-limits")
        .querySelector("tbody").innerHTML =
        limRow("최대 유저 수", gl.maxUsers) +
        limRow("최대 활성 유저", gl.maxActiveUsers) +
        limRow("동시 요청", gl.maxConcurrency) +
        limRow("RPM", gl.maxRpm) +
        limRow("RPH", gl.maxRph) +
        limRow("RPD", gl.maxRpd);
      document
        .getElementById("sv-user-limits")
        .querySelector("tbody").innerHTML =
        limRow("쿼터", ul.quota) +
        limRow("쿼터 리필", refillLabel[ul.quotaRefillMode] || "-") +
        limRow("동시 요청", ul.maxConcurrency) +
        limRow("RPM", ul.maxRpm) +
        limRow("RPH", ul.maxRph) +
        limRow("RPD", ul.maxRpd);
    }

    if (usage.success) {
      const { daily, byModel } = usage.data;
      currentSvDaily = daily;
      currentSvModel = byModel;
      updateSvChartType();
    }
  } catch (e) {
    document.getElementById("sv-status").innerText = "OFFLINE";
    document.getElementById("sv-status").className = "stat-val bad";
  }
}

function updateSvChartType() {
  const metric = document.getElementById("sv-metric-select").value;
  const res = document.getElementById("sv-res-select").value;

  const trange = document.getElementById("sv-time-range");
  if (trange) trange.innerText = getTimeRangeText(res);

  clearChart("sv-daily-chart");
  clearChart("sv-model-chart");

  const dailyEmpty = document.getElementById("sv-daily-empty");
  const modelEmpty = document.getElementById("sv-model-empty");

  if (currentSvDaily.length > 0) {
    if (dailyEmpty) dailyEmpty.style.display = "none";
    const { labels, filledData } = fillEmptySlots(currentSvDaily, res);
    renderBarChart("sv-daily-chart", labels, filledData, metric);
  } else {
    if (dailyEmpty) dailyEmpty.style.display = "flex";
  }

  if (currentSvModel.length > 0) {
    if (modelEmpty) modelEmpty.style.display = "none";
    renderDonutChart("sv-model-chart", currentSvModel, metric);
  } else {
    if (modelEmpty) modelEmpty.style.display = "flex";
  }
}

// ── TAB 5: 관리 ─────────────────────────────────────────────────
function checkAdminAuthOnLoad() {
  const pw = localStorage.getItem(ADMIN_TOKEN_STORAGE);
  if (pw) {
    currentAdminPw = pw;
    fetchAdminPanel();
  } else {
    document.getElementById("admin-login").classList.remove("hidden");
    document.getElementById("admin-dashboard").classList.add("hidden");
  }
}

function loginAdmin() {
  const pw = document.getElementById("admin-pw").value;
  if (!pw) return;
  currentAdminPw = pw;
  localStorage.setItem(ADMIN_TOKEN_STORAGE, pw);
  fetchAdminPanel();
}

function logoutAdmin() {
  localStorage.removeItem(ADMIN_TOKEN_STORAGE);
  currentAdminPw = "";
  checkAdminAuthOnLoad();
}

async function fetchAdminPanel() {
  try {
    const res = await fetch("/api/admin/settings", {
      headers: { Authorization: `Admin ${currentAdminPw}` },
    });
    const body = await res.json();
    if (body.success) {
      document.getElementById("admin-post-url").value = body.data.arcaPostUrl;
      document.getElementById("admin-login").classList.add("hidden");
      document.getElementById("admin-dashboard").classList.remove("hidden");
      fetchTopUsers();
      fetchAdminLists();
    } else {
      alert("인증 실패: " + body.error);
      logoutAdmin();
    }
  } catch (e) {
    alert("통신 오류");
    logoutAdmin();
  }
}

async function fetchTopUsers() {
  const tbody = document.getElementById("top-users-body");
  try {
    const res = await fetch("/api/admin/stats/top-users", {
      headers: { Authorization: `Admin ${currentAdminPw}` },
    });
    const body = await res.json();
    if (body.lastUpdatedAt) {
      document.getElementById("admin-top-updated").innerText =
        "마지막 업데이트: " +
        new Date(body.lastUpdatedAt).toLocaleTimeString("ko-KR", {
          hour12: false,
        });
    }
    tbody.innerHTML = "";
    if (!body.success || !body.data.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="text-align:center;color:var(--muted)">데이터 없음</td></tr>';
      return;
    }
    body.data.forEach((u, i) => {
      const p = getArcaProfile(u.arca_id, u.display_name);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="font-weight:700;color:var(--muted)">${i + 1}</td>
        <td><a href="${p.url}" target="_blank" class="arca-link">${p.text}</a></td>
        <td><span class="badge badge-${escapeHTML(u.status)}">${escapeHTML(u.status)}</span></td>
        <td>${fmtNum(u.total_requests)}건</td>
        <td><strong>${fmtNum(u.total_cost)}</strong></td>
        <td>${fmtNum(u.credit_balance)}</td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center;color:var(--danger)">로드 실패</td></tr>';
  }
}

async function updatePostUrl() {
  const url = document.getElementById("admin-post-url").value.trim();
  try {
    const res = await fetch("/api/admin/settings/arca-post-url", {
      method: "POST",
      headers: {
        Authorization: `Admin ${currentAdminPw}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });
    const body = await res.json();
    alert(body.message || body.error);
  } catch (e) {
    alert("업데이트 실패");
  }
}

async function reloadModels() {
  if (!confirm("models.json을 서버에서 다시 불러올까요?")) return;
  try {
    const res = await fetch("/api/admin/models/reload", {
      method: "POST",
      headers: { Authorization: `Admin ${currentAdminPw}` },
    });
    const body = await res.json();
    alert(body.message || body.error);
    if (body.success) fetchDocs();
  } catch (e) {
    alert("리로드 실패");
  }
}

async function reloadEnv() {
  if (
    !confirm(
      ".env 파일의 변경사항을 즉시 적용할까요?\n(서버 재시작이 필요한 일부 설정 제외)",
    )
  )
    return;
  try {
    const res = await fetch("/api/admin/env/reload", {
      method: "POST",
      headers: { Authorization: `Admin ${currentAdminPw}` },
    });
    const body = await res.json();
    alert(body.message || body.error);
  } catch (e) {
    alert("리로드 실패");
  }
}

async function searchUser() {
  const q = document.getElementById("admin-search-q").value.trim();
  if (!q) return;
  const cont = document.getElementById("admin-user-results");
  cont.innerHTML =
    '<p style="color:var(--muted);font-size:13px">검색 중...</p>';
  try {
    const res = await fetch(
      `/api/admin/users/search?q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Admin ${currentAdminPw}` } },
    );
    const body = await res.json();
    cont.innerHTML = "";
    if (!body.success || !body.data.length) {
      cont.innerHTML =
        '<p style="color:var(--muted);font-size:13px">검색 결과가 없습니다.</p>';
      return;
    }
    body.data.forEach((u) => {
      const p = getArcaProfile(u.arca_id, u.display_name);
      const div = document.createElement("div");
      div.className = "user-panel";
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <a href="${p.url}" target="_blank" class="arca-link">${p.text}</a>
            <span class="badge badge-${escapeHTML(u.status)}" style="margin-left:6px">${escapeHTML(u.status)}</span>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn-sm" onclick="toggleUserStats('${escapeHTML(u.arca_id)}', this)" style="background:var(--accent)">통계</button>
            <button class="btn-sm" onclick="addCreditToUser('${escapeHTML(u.arca_id)}')" style="background:var(--muted)">크레딧</button>
            ${
              u.status === "suspended"
                ? `<button class="btn-sm btn-success" onclick="unsuspendUser('${escapeHTML(u.arca_id)}')">정지 해제</button>`
                : `
                  <button class="btn-sm btn-danger" onclick="suspendUser('${escapeHTML(u.arca_id)}')">영구 정지</button>
                  ${u.status === "active" ? `<button class="btn-sm btn-warning" onclick="revokeUserKey('${escapeHTML(u.arca_id)}')">키 파기</button>` : ""}
                `
            }
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--muted);margin-top:6px">
          <div>잔여 크레딧: <strong>${fmtNum(u.credit_balance)}</strong> | 최근 사용: ${u.last_used_at ? fmtDate(u.last_used_at) : "없음"}</div>
          <div id="stats-time-${escapeHTML(u.arca_id)}" style="font-size:12px"></div>
        </div>
        <div id="stats-panel-${escapeHTML(u.arca_id)}" class="hidden" style="margin-top:12px"></div>`;
      cont.appendChild(div);
    });
  } catch (e) {
    cont.innerHTML =
      '<p style="color:var(--danger);font-size:13px">검색 실패</p>';
  }
}

async function toggleUserStats(arcaId, btn) {
  const panel = document.getElementById(`stats-panel-${arcaId}`);
  if (!panel.classList.contains("hidden")) {
    panel.classList.add("hidden");
    btn.innerText = "통계";
    return;
  }
  btn.innerText = "로딩...";
  try {
    const resReq = await fetch(`/api/admin/stats/user/${arcaId}?res=1h`, {
      headers: { Authorization: `Admin ${currentAdminPw}` },
    });
    const body = await resReq.json();
    if (!body.success) {
      panel.innerHTML =
        '<p style="color:var(--danger);font-size:13px">로드 실패</p>';
      panel.classList.remove("hidden");
      btn.innerText = "통계";
      return;
    }
    const { daily, byModel, recentLogs, totals } = body.data;
    const safe = arcaId.replace(/[^a-z0-9_]/gi, "_");

    if (body.lastUpdatedAt) {
      document.getElementById(`stats-time-${arcaId}`).innerText =
        "마지막 업데이트: " +
        new Date(body.lastUpdatedAt).toLocaleTimeString("ko-KR", {
          hour12: false,
        });
    }

    panel.innerHTML = `
      <div class="grid2" style="margin-bottom:10px">
        <div class="stat-card"><h3>전체 요청</h3><div class="stat-val" style="font-size:18px">${fmtNum(totals.total_requests)}</div></div>
        <div class="stat-card"><h3>전체 소비</h3><div class="stat-val" style="font-size:18px">${fmtNum(totals.total_cost)}</div></div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-bottom:4px;gap:4px">
         <select id="adm-metric-${safe}" onchange="updateAdminMetricOnly('${arcaId}')" style="padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); font-size: 12px;">
           <option value="requests">호출수</option>
           <option value="cost" selected>크레딧</option>
           <option value="tokens">토큰</option>
         </select>
         <select id="adm-res-${safe}" onchange="refreshAdminUserCharts('${arcaId}')" style="padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); font-size: 12px;">
           <option value="1d">1일</option>
           <option value="1h" selected>1시간</option>
           <option value="15m">15분</option>
           <option value="5m">5분</option>
         </select>
      </div>
      <div style="margin-bottom:10px; padding: 0 16px;">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">통계 그래프</div>
        <div class="chart-wrap" style="position:relative">
          <div id="adm-daily-empty-${safe}" style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;font-size:12px;color:var(--muted);z-index:10">데이터가 없습니다</div>
          <div id="adm-daily-${safe}"></div>
        </div>
        <div class="chart-doughnut-section">
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">모델별 분포</div>
          <div class="chart-wrap" style="position:relative">
            <div id="adm-model-empty-${safe}" style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;font-size:12px;color:var(--muted);z-index:10">데이터가 없습니다</div>
            <div id="adm-model-${safe}"></div>
          </div>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>시간</th><th>모델</th><th>입력</th><th>출력</th><th>비용</th></tr></thead>
          <tbody id="adm-log-${safe}"></tbody>
        </table>
      </div>`;

    panel.classList.remove("hidden");
    btn.innerText = "닫기";

    adminUserState[safe] = {
      currentDaily: daily,
      currentModel: byModel,
    };
    updateAdminChartRender(safe, "cost", "1h");

    const tbody = document.getElementById(`adm-log-${safe}`);
    if (recentLogs.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;color:var(--muted)">없음</td></tr>';
    } else
      recentLogs.slice(0, 10).forEach((l) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${fmtDate(l.created_at)}</td><td>${escapeHTML(limitStr(l.model_name, 18))}</td><td>${fmtNum(l.tokens_prompt)}</td><td>${fmtNum(l.tokens_completion)}</td><td><strong>${fmtNum(l.cost)}</strong></td>`;
        tbody.appendChild(tr);
      });
  } catch (e) {
    panel.innerHTML =
      '<p style="color:var(--danger);font-size:13px">통신 오류</p>';
    panel.classList.remove("hidden");
    btn.innerText = "📊 통계";
  }
}

async function suspendUser(arcaId) {
  if (
    !confirm(
      `[${arcaId}] 영구 정지하시겠습니까?\n기존 API 키가 즉시 무력화됩니다.`,
    )
  )
    return;
  try {
    const res = await fetch(`/api/admin/users/${arcaId}/suspend`, {
      method: "POST",
      headers: { Authorization: `Admin ${currentAdminPw}` },
    });
    const body = await res.json();
    alert(body.message || body.error);
    searchUser();
    fetchTopUsers();
  } catch (e) {
    alert("처리 실패");
  }
}

async function unsuspendUser(arcaId) {
  if (!confirm(`[${arcaId}] 정지를 해제하시겠습니까?`)) return;
  try {
    const res = await fetch(`/api/admin/users/${arcaId}/unsuspend`, {
      method: "POST",
      headers: { Authorization: `Admin ${currentAdminPw}` },
    });
    const body = await res.json();
    alert(body.message || body.error);
    searchUser();
    fetchTopUsers();
  } catch (e) {
    alert("처리 실패");
  }
}

async function revokeUserKey(arcaId) {
  if (
    !confirm(
      `[${arcaId}] 해당 사용자의 현재 API 키를 파기하시겠습니까?\n사용자는 다시 키를 발급받아야 AI를 이용할 수 있게 됩니다.`,
    )
  )
    return;
  try {
    const res = await fetch(`/api/admin/users/${arcaId}/revoke`, {
      method: "POST",
      headers: { Authorization: `Admin ${currentAdminPw}` },
    });
    const body = await res.json();
    alert(body.message || body.error);
    searchUser();
    fetchTopUsers();
  } catch (e) {
    alert("처리 실패");
  }
}

async function addCreditToUser(arcaId) {
  const input = prompt(`[${arcaId}] 충전할 크레딧 금액을 입력하세요.\n(음수 입력 시 차감)`);
  if (input === null) return;

  const amount = parseInt(input, 10);
  if (isNaN(amount) || amount === 0) {
    alert("올바른 숫자를 입력해주세요.");
    return;
  }

  try {
    const res = await fetch(`/api/admin/users/${arcaId}/credit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Admin ${currentAdminPw}`,
      },
      body: JSON.stringify({ amount }),
    });
    const body = await res.json();
    alert(body.message || body.error);
    if (body.success) {
      searchUser();
      fetchTopUsers();
    }
  } catch (e) {
    alert("처리 실패");
  }
}

async function resetGlobalQuota() {
  if (!confirm("서버 전역 사용량을 0으로 리셋하시겠습니까?")) return;

  try {
    const res = await fetch("/api/admin/quota/reset", {
      method: "POST",
      headers: { Authorization: `Admin ${currentAdminPw}` },
    });
    const body = await res.json();
    alert(body.message || body.error);
  } catch (e) {
    alert("처리 실패");
  }
}

async function fetchAdminLists() {
  const whitelistDiv = document.getElementById("whitelist-container");
  const bannedDiv = document.getElementById("banned-container");
  
  try {
    const res = await fetch("/api/admin/users/lists", {
      headers: { Authorization: `Admin ${currentAdminPw}` }
    });
    const body = await res.json();
    
    if (!body.success) {
      whitelistDiv.innerHTML = '<div style="text-align:center; color: var(--danger); padding: 20px;">로드 실패</div>';
      bannedDiv.innerHTML = '<div style="text-align:center; color: var(--danger); padding: 20px;">로드 실패</div>';
      return;
    }

    const { whitelist, suspended } = body.data;

    if (whitelist.length === 0) {
      whitelistDiv.innerHTML = '<div style="text-align:center; color: var(--muted); padding: 20px;">화이트리스트 유저가 없습니다.</div>';
    } else {
      whitelistDiv.innerHTML = whitelist.map(u => {
        const p = getArcaProfile(u.arca_id, u.display_name);
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding: 6px 0; border-bottom: 1px solid var(--border)">
            <div><a href="${p.url}" target="_blank" class="arca-link">${p.text}</a></div>
            <button class="btn-sm btn-danger" onclick="removeWhitelist('${escapeHTML(u.arca_id)}')">명단 제외</button>
          </div>
        `;
      }).join("");
    }

    if (suspended.length === 0) {
      bannedDiv.innerHTML = '<div style="text-align:center; color: var(--muted); padding: 20px;">차단된 유저가 없습니다.</div>';
    } else {
      bannedDiv.innerHTML = suspended.map(u => {
        const p = getArcaProfile(u.arca_id, u.display_name);
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding: 6px 0; border-bottom: 1px solid var(--border)">
            <div><a href="${p.url}" target="_blank" class="arca-link">${p.text}</a></div>
            <button class="btn-sm btn-success" onclick="unsuspendUserFromList('${escapeHTML(u.arca_id)}')">정지 해제</button>
          </div>
        `;
      }).join("");
    }

  } catch (e) {
    whitelistDiv.innerHTML = '<div style="text-align:center; color: var(--danger); padding: 20px;">통신 오류</div>';
    bannedDiv.innerHTML = '<div style="text-align:center; color: var(--danger); padding: 20px;">통신 오류</div>';
  }
}

async function addWhitelist() {
  const urlInput = document.getElementById("admin-whitelist-url").value.trim();
  if (!urlInput) {
    alert("URL을 입력해주세요.");
    return;
  }
  try {
    const res = await fetch("/api/admin/whitelist", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Admin ${currentAdminPw}` },
      body: JSON.stringify({ url: urlInput })
    });
    const body = await res.json();
    if (body.success) {
      document.getElementById("admin-whitelist-url").value = "";
      alert(body.message);
      fetchAdminLists();
    } else {
      alert("등록 실패: " + body.error);
    }
  } catch (e) {
    alert("통신 오류");
  }
}

async function removeWhitelist(arcaId) {
  if (!confirm(`정말로 [${arcaId}] 님을 화이트리스트에서 제외하시겠습니까?`)) return;
  try {
    const res = await fetch(`/api/admin/whitelist/${arcaId}`, {
      method: "DELETE",
      headers: { "Authorization": `Admin ${currentAdminPw}` }
    });
    const body = await res.json();
    if (body.success) {
      fetchAdminLists();
    } else {
      alert("삭제 실패: " + body.error);
    }
  } catch (e) {
    alert("통신 오류");
  }
}

async function unsuspendUserFromList(arcaId) {
  await unsuspendUser(arcaId);
  fetchAdminLists(); // Reload lists
}
