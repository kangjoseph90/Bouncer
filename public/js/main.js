      // ── 상수 & 상태 ──────────────────────────────────────────────────
      const API_KEY_STORAGE = "bouncer_api_key";
      const ADMIN_TOKEN_STORAGE = "bouncer_admin_pw";
      let currentApiKey = "",
        currentAdminPw = "",
        currentTempToken = "";
      let tokenTimerInterval = null;
      let dashDailyChart = null,
        dashModelChart = null,
        svDailyChart = null,
        svModelChart = null;

      const CHART_COLORS = [
        "#5b6aff",
        "#ff6b6b",
        "#ffa94d",
        "#69db7c",
        "#4fc3f7",
        "#ce93d8",
        "#ffcc02",
        "#ff8a65",
      ];

      // ── 유틸 ────────────────────────────────────────────────────────
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
            text: `@${nm}`,
            url: `https://arca.live/u/@${encodeURIComponent(nm)}`,
          };
        }
        if (arcaId.startsWith("half_")) {
          const num = arcaId.replace("half_", "");
          return {
            text: `@${displayName}#${num}`,
            url: `https://arca.live/u/@${encodeURIComponent(displayName)}/${num}`,
          };
        }
        return { text: arcaId, url: "#" };
      }

      function destroyChart(chartRef) {
        if (chartRef) {
          chartRef.destroy();
        }
        return null;
      }

      function renderBarChart(canvasId, labels, data, label) {
        const ctx = document.getElementById(canvasId).getContext("2d");
        return new Chart(ctx, {
          type: "bar",
          data: {
            labels,
            datasets: [
              {
                label,
                data,
                backgroundColor: "#5b6aff99",
                borderColor: "#5b6aff",
                borderWidth: 1.5,
                borderRadius: 5,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { font: { size: 11 } } },
              y: { ticks: { font: { size: 11 } }, beginAtZero: true },
            },
          },
        });
      }

      function renderDoughnutChart(canvasId, labels, data) {
        const ctx = document.getElementById(canvasId).getContext("2d");
        return new Chart(ctx, {
          type: "doughnut",
          data: {
            labels,
            datasets: [{ data, backgroundColor: CHART_COLORS, borderWidth: 2 }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: "bottom",
                labels: { font: { size: 11 }, boxWidth: 12 },
              },
            },
          },
        });
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
        try {
          const [baseRes, statsRes] = await Promise.all([
            fetch("/api/dashboard", {
              headers: { Authorization: `Bearer ${currentApiKey}` },
            }),
            fetch("/api/stats/user/usage", {
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

              dashDailyChart = destroyChart(dashDailyChart);
              dashModelChart = destroyChart(dashModelChart);

              if (daily.length > 0) {
                dashDailyChart = renderBarChart(
                  "dash-daily-chart",
                  daily.map((d) => d.date.slice(5)),
                  daily.map((d) => d.total_cost),
                  "소비 크레딧",
                );
              }
              if (byModel.length > 0) {
                dashModelChart = renderDoughnutChart(
                  "dash-model-chart",
                  byModel.map((m) => limitStr(m.model_name)),
                  byModel.map((m) => m.total_cost),
                );
              }

              const tbody = document.getElementById("dash-log-body");
              tbody.innerHTML = "";
              if (recentLogs.length === 0) {
                tbody.innerHTML =
                  '<tr><td colspan="6" style="text-align:center;color:var(--muted)">사용 기록이 없습니다.</td></tr>';
              } else {
                recentLogs.forEach((l) => {
                  const tr = document.createElement("tr");
                  tr.innerHTML = `<td>${fmtDate(l.created_at)}</td><td>${limitStr(l.model_name, 18)}</td><td>${fmtNum(l.tokens_prompt)}</td><td>${fmtNum(l.tokens_completion)}</td><td>${fmtNum(l.tokens_cached)}</td><td><strong>${fmtNum(l.cost)}</strong></td>`;
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
        try {
          const [serverRes, usageRes] = await Promise.all([
            fetch("/api/stats/server"),
            fetch("/api/stats/server/usage"),
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
              limRow("RPD", gl.maxRpd);
            document
              .getElementById("sv-user-limits")
              .querySelector("tbody").innerHTML =
              limRow("쿼터", ul.quota) +
              limRow("쿼터 리필", refillLabel[ul.quotaRefillMode] || "-") +
              limRow("동시 요청", ul.maxConcurrency) +
              limRow("RPM", ul.maxRpm) +
              limRow("RPD", ul.maxRpd);
          }

          if (usage.success) {
            const { daily, byModel } = usage.data;
            svDailyChart = destroyChart(svDailyChart);
            svModelChart = destroyChart(svModelChart);
            if (daily.length > 0)
              svDailyChart = renderBarChart(
                "sv-daily-chart",
                daily.map((d) => d.date.slice(5)),
                daily.map((d) => d.total_requests),
                "요청 수",
              );
            if (byModel.length > 0)
              svModelChart = renderDoughnutChart(
                "sv-model-chart",
                byModel.map((m) => limitStr(m.model_name)),
                byModel.map((m) => m.total_cost),
              );
          }
        } catch (e) {
          document.getElementById("sv-status").innerText = "OFFLINE";
          document.getElementById("sv-status").className = "stat-val bad";
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
            document.getElementById("admin-post-url").value =
              body.data.arcaPostUrl;
            document.getElementById("admin-login").classList.add("hidden");
            document
              .getElementById("admin-dashboard")
              .classList.remove("hidden");
            fetchTopUsers();
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
        <td><span class="badge badge-${u.status}">${u.status}</span></td>
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
        if (!confirm(".env 파일의 변경사항을 즉시 적용할까요?\n(서버 재시작이 필요한 일부 설정 제외)")) return;
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
            <span class="badge badge-${u.status}" style="margin-left:6px">${u.status}</span>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn-sm" onclick="toggleUserStats('${u.arca_id}', this)" style="background:var(--accent)">통계</button>
            ${
              u.status === "suspended"
                ? `<button class="btn-sm btn-success" onclick="unsuspendUser('${u.arca_id}')">해제</button>`
                : `<button class="btn-sm btn-danger" onclick="suspendUser('${u.arca_id}')">정지</button>`
            }
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--muted);margin-top:6px">
          <div>잔여 크레딧: <strong>${fmtNum(u.credit_balance)}</strong> | 최근 사용: ${u.last_used_at ? fmtDate(u.last_used_at) : "없음"}</div>
          <div id="stats-time-${u.arca_id}" style="font-size:12px"></div>
        </div>
        <div id="stats-panel-${u.arca_id}" class="hidden" style="margin-top:12px"></div>`;
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
          const res = await fetch(`/api/admin/stats/user/${arcaId}`, {
            headers: { Authorization: `Admin ${currentAdminPw}` },
          });
          const body = await res.json();
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
      <div class="grid2" style="margin-bottom:10px">
        <div><div style="font-size:12px;color:var(--muted);margin-bottom:4px">7일 일별 소비</div><div class="chart-wrap" style="height:160px"><canvas id="adm-daily-${safe}"></canvas></div></div>
        <div><div style="font-size:12px;color:var(--muted);margin-bottom:4px">모델별 분포</div><div class="chart-wrap" style="height:160px"><canvas id="adm-model-${safe}"></canvas></div></div>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>시간</th><th>모델</th><th>입력</th><th>출력</th><th>비용</th></tr></thead>
          <tbody id="adm-log-${safe}"></tbody>
        </table>
      </div>`;

          panel.classList.remove("hidden");
          btn.innerText = "닫기";

          if (daily.length > 0)
            renderBarChart(
              `adm-daily-${safe}`,
              daily.map((d) => d.date.slice(5)),
              daily.map((d) => d.total_cost),
              "소비",
            );
          if (byModel.length > 0)
            renderDoughnutChart(
              `adm-model-${safe}`,
              byModel.map((m) => limitStr(m.model_name)),
              byModel.map((m) => m.total_cost),
            );

          const tbody = document.getElementById(`adm-log-${safe}`);
          if (recentLogs.length === 0) {
            tbody.innerHTML =
              '<tr><td colspan="5" style="text-align:center;color:var(--muted)">없음</td></tr>';
          } else
            recentLogs.slice(0, 10).forEach((l) => {
              const tr = document.createElement("tr");
              tr.innerHTML = `<td>${fmtDate(l.created_at)}</td><td>${limitStr(l.model_name, 18)}</td><td>${fmtNum(l.tokens_prompt)}</td><td>${fmtNum(l.tokens_completion)}</td><td><strong>${fmtNum(l.cost)}</strong></td>`;
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