#!/usr/bin/env node
/**
 * TRINITY AI AGENCY — 로컬 Claude Code 브리지
 *
 * 픽셀 오피스(브라우저)와 내 PC의 Claude Code CLI를 연결하는 초소형 중계 서버.
 * API 키 없이 Claude 구독(Pro/Max)으로 직원들이 일하게 해줍니다.
 *
 * 사용법:
 *   1) Claude Code 설치 + 로그인  (https://claude.com/claude-code)
 *   2) node bridge/claude-bridge.mjs
 *   3) 픽셀 오피스 ⚙ API 연결 → 브리지 주소에 http://127.0.0.1:8787 저장
 *
 * 이 서버는 127.0.0.1(내 PC)에만 열리며 외부에서 접근할 수 없습니다.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8787);
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const ALLOWED_ORIGINS = new Set([
  "https://hq1trinity-arch.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "null", // file:// 로 열었을 때
]);

function corsHeaders(req) {
  const origin = req.headers.origin || "null";
  if (!ALLOWED_ORIGINS.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Private-Network": "true",
  };
}

const BRIDGE_VERSION = "v6";

/* ══════════ 정기 업무 스케줄러 ══════════
   schedules.json: 사이트에서 등록한 반복 지시 목록
   outbox.json:   완료된 결과물 발신함 (사이트가 수거해감)          */
const DATA_DIR = dirname(fileURLToPath(import.meta.url));
const SCHED_FILE = join(DATA_DIR, "schedules.json");
const OUTBOX_FILE = join(DATA_DIR, "outbox.json");
const loadJson = (f, d) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch (_) { return d; } };
let schedules = loadJson(SCHED_FILE, []);
let outbox = loadJson(OUTBOX_FILE, []);
const saveSchedules = () => { try { writeFileSync(SCHED_FILE, JSON.stringify(schedules, null, 2)); } catch (_) {} };
const saveOutbox = () => { try { writeFileSync(OUTBOX_FILE, JSON.stringify(outbox, null, 2)); } catch (_) {} };

const WORKER_GUIDE =
  " 최신 정보나 사실 확인이 필요하면 웹 검색을 활용해 반영하세요." +
  " 카드뉴스·배너·썸네일 등 이미지 결과물 요청은 각 장을 완결된 SVG 코드로 제출하세요:" +
  " 장마다 별도의 ```svg 코드블록, <svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1080 1080\">로 시작," +
  " 모든 문구는 <text>/<tspan> 요소로 넣고(줄바꿈은 tspan), 폰트는 system-ui·sans-serif 계열만," +
  " 외부 이미지·외부 폰트·스크립트 참조는 금지. 배경·도형·색상 대비를 적극 활용해 완성도 있게." +
  " 인사말이나 '다음은 ~입니다' 같은 서두·맺음말 없이 결과물 본문만 출력하세요.";

function sanitizeSchedules(raw) {
  if (!Array.isArray(raw)) return [];
  const prev = new Map(schedules.map(s => [s.id, s]));
  return raw.slice(0, 20).map(s => ({
    id: String(s.id || Date.now() + "-" + Math.random().toString(36).slice(2, 7)),
    instruction: String(s.instruction || "").slice(0, 500),
    roleName: String(s.roleName || "만능비서").slice(0, 8),
    freq: s.freq === "weekly" ? "weekly" : "daily",
    day: Math.min(6, Math.max(0, Number(s.day) || 0)),
    hour: Math.min(23, Math.max(0, Number(s.hour) || 0)),
    minute: Math.min(59, Math.max(0, Number(s.minute) || 0)),
    enabled: !!s.enabled,
    lastSlot: (prev.get(String(s.id)) || {}).lastSlot || null,
  })).filter(s => s.instruction);
}

/* 오늘 실행할 차례인지: 요일·시각이 지났고 아직 오늘 안 돌았으면 실행 (늦게 켜도 당일이면 따라잡음) */
function dueSlot(s, now) {
  const d = new Date(now);
  if (s.freq === "weekly" && d.getDay() !== s.day) return null;
  if (d.getHours() < s.hour || (d.getHours() === s.hour && d.getMinutes() < s.minute)) return null;
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

async function runScheduled(s) {
  console.log("[정기 업무 실행]", s.instruction.slice(0, 40));
  const prompt =
    "당신은 AI 에이전시 'TRINITY AI AGENCY'의 " + s.roleName + "입니다. " +
    "아래의 정기 지시를 수행해 완성된 결과물을 한국어로 작성하세요." + WORKER_GUIDE +
    "\n\n지시: " + s.instruction;
  await acquireSlot();
  try {
    const result = await runClaude(prompt);
    outbox.push({
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      ts: Date.now(),
      title: s.instruction.length > 18 ? s.instruction.slice(0, 18) + "…" : s.instruction,
      roleName: s.roleName, instruction: s.instruction, result,
    });
    saveOutbox();
    console.log("[정기 업무 완료 → 발신함 대기 " + outbox.length + "건]");
  } catch (e) {
    console.error("[정기 업무 실패]", e.message);
  } finally { releaseSlot(); }
}

setInterval(() => {
  const now = Date.now();
  for (const s of schedules) {
    if (!s.enabled) continue;
    const slot = dueSlot(s, now);
    if (slot && s.lastSlot !== slot) {
      s.lastSlot = slot;
      saveSchedules();
      runScheduled(s);
    }
  }
}, Number(process.env.SCHED_TICK_MS || 30000));

/* PC 과부하 방지: Claude Code 동시 실행 제한 (초과분은 대기열에서 순서대로) */
const MAX_CONCURRENT = Math.max(1, Number(process.env.MAX_CONCURRENT || 2));
let runningJobs = 0;
const jobQueue = [];
function acquireSlot() {
  return new Promise(resolve => {
    if (runningJobs < MAX_CONCURRENT) { runningJobs++; resolve(); }
    else { jobQueue.push(resolve); console.log("  [대기열] 앞선 작업 " + runningJobs + "건 진행 중 — 순서 대기"); }
  });
}
function releaseSlot() {
  const next = jobQueue.shift();
  if (next) next();
  else runningJobs--;
}
const IS_WIN = process.platform === "win32";

/* Windows에서는 claude가 claude.cmd / claude.exe 로 설치되므로 후보를 순서대로 시도.
   마지막 후보 __cmdexe__ 는 cmd.exe에 실행 자체를 위임하는 최후 수단(Windows 전용). */
const BIN_CANDIDATES = [CLAUDE_BIN, "claude", "claude.cmd", "claude.exe"]
  .filter((v, i, a) => a.indexOf(v) === i)
  .concat(IS_WIN ? ["__cmdexe__"] : []);
let resolvedBin = null;

/* 직원들이 인터넷 검색을 쓸 수 있게 헤드리스 모드에 웹 도구 권한 부여 */
const CLAUDE_ARGS = ["-p", "--allowedTools", "WebSearch", "WebFetch"];

function spawnSpec(bin) {
  if (bin === "__cmdexe__") {
    return {
      cmd: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", "claude " + CLAUDE_ARGS.join(" ")],
      opts: { windowsVerbatimArguments: true },
    };
  }
  /* .cmd/.bat 은 Node 보안 정책상 셸 경유가 필수(EINVAL 방지).
     명령줄은 고정 문자열뿐이고 프롬프트는 stdin이라 안전합니다. */
  const needsShell = IS_WIN && /\.(cmd|bat)$/i.test(bin);
  return { cmd: bin, args: CLAUDE_ARGS.slice(), opts: needsShell ? { shell: true } : {} };
}

function trySpawn(bin, prompt) {
  return new Promise((resolve, reject) => {
    const spec = spawnSpec(bin);
    // 프롬프트는 stdin으로 전달 → 인젝션·명령줄 길이 제한 없음
    const p = spawn(spec.cmd, spec.args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10 * 60 * 1000,
      ...spec.opts,
    });
    let out = "", err = "";
    p.stdout.on("data", d => { out += d; });
    p.stderr.on("data", d => { err += d; });
    p.on("error", e => reject(e));
    p.on("close", code => {
      if (code === 0) resolve(out.trim());
      else reject(new Error((err || out || "claude exited " + code).trim().slice(0, 300)));
    });
    p.stdin.on("error", () => {});
    p.stdin.write(prompt);
    p.stdin.end();
  });
}

async function runClaude(prompt) {
  const candidates = resolvedBin ? [resolvedBin] : BIN_CANDIDATES;
  let lastErr = null;
  for (const bin of candidates) {
    try {
      const out = await trySpawn(bin, prompt);
      if (resolvedBin !== bin) console.log("  [실행 파일 확정]", bin);
      resolvedBin = bin;   /* 성공한 실행 방식 기억 */
      return out;
    } catch (e) {
      lastErr = e;
      /* ENOENT: 이 이름은 없음 / EINVAL: 이 방식으론 실행 불가 → 다음 후보 시도 */
      if (e.code === "ENOENT" || e.code === "EINVAL") {
        console.log("  [후보 실패]", bin, "→", e.code);
        continue;
      }
      throw e;             /* 실행은 됐는데 실패 → 실제 오류 전달 */
    }
  }
  if (lastErr && (lastErr.code === "ENOENT" || lastErr.code === "EINVAL")) {
    throw new Error(
      "claude 명령을 찾을 수 없습니다. ① Claude Code 설치(https://claude.com/claude-code) → " +
      "② 새 터미널에서 `claude --version` 확인 → ③ 그 터미널에서 브리지를 다시 실행하세요."
    );
  }
  throw lastErr;
}

const server = createServer(async (req, res) => {
  const cors = corsHeaders(req);
  if (!cors) { res.writeHead(403); res.end("forbidden origin"); return; }
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }

  if (req.method === "GET" && req.url === "/ping") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, engine: "claude-code", version: BRIDGE_VERSION }));
    return;
  }

  /* ── 정기 업무 스케줄 CRUD ── */
  if (req.method === "GET" && req.url === "/schedules") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ schedules }));
    return;
  }
  if (req.method === "POST" && req.url === "/schedules") {
    let body = "";
    req.on("data", d => { body += d; if (body.length > 200_000) req.destroy(); });
    req.on("end", () => {
      try {
        schedules = sanitizeSchedules(JSON.parse(body || "{}").schedules);
        saveSchedules();
        console.log("[정기 업무 저장]", schedules.length + "건");
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, schedules }));
      } catch (e) {
        res.writeHead(400, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  /* ── 발신함: 완료된 정기 업무 결과 수거 ── */
  if (req.method === "GET" && req.url === "/outbox") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ items: outbox }));
    return;
  }
  if (req.method === "POST" && req.url === "/ack") {
    let body = "";
    req.on("data", d => { body += d; if (body.length > 200_000) req.destroy(); });
    req.on("end", () => {
      try {
        const ids = new Set((JSON.parse(body || "{}").ids || []).map(String));
        outbox = outbox.filter(i => !ids.has(String(i.id)));
        saveOutbox();
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/run") {
    let body = "";
    req.on("data", d => { body += d; if (body.length > 200_000) req.destroy(); });
    req.on("end", async () => {
      try {
        const { prompt } = JSON.parse(body || "{}");
        if (!prompt || typeof prompt !== "string") throw new Error("prompt가 비어 있습니다");
        console.log("[작업 수신]", prompt.slice(0, 60).replace(/\n/g, " ") + "...");
        await acquireSlot();
        let result;
        try { result = await runClaude(prompt); }
        finally { releaseSlot(); }
        console.log("[완료]", result.length + "자");
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ result }));
      } catch (e) {
        console.error("[오류]", e.message);
        res.writeHead(500, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, cors); res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("  🏢 TRINITY AI AGENCY 브리지 " + BRIDGE_VERSION + " 가동 — http://127.0.0.1:" + PORT);
  console.log("  픽셀 오피스 ⚙ 설정에서 위 주소를 저장하면 Claude Code(구독)로 직원들이 일합니다.");
  console.log("  정기 업무 " + schedules.length + "건 등록됨 · 발신함 대기 " + outbox.length + "건");
  console.log("  종료: Ctrl+C");
  console.log("");
});
