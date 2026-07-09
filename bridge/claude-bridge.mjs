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

const BRIDGE_VERSION = "v4";
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

  if (req.method === "POST" && req.url === "/run") {
    let body = "";
    req.on("data", d => { body += d; if (body.length > 200_000) req.destroy(); });
    req.on("end", async () => {
      try {
        const { prompt } = JSON.parse(body || "{}");
        if (!prompt || typeof prompt !== "string") throw new Error("prompt가 비어 있습니다");
        console.log("[작업 수신]", prompt.slice(0, 60).replace(/\n/g, " ") + "...");
        const result = await runClaude(prompt);
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
  console.log("  종료: Ctrl+C");
  console.log("");
});
