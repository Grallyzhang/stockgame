# 本地行情服务：浏览器前端 ←HTTP→ 本服务 ←→ AKShare
# 启动：python server/app.py （默认 http://127.0.0.1:8500）
import json
import re
import traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import config
import quotes

CODE_RE = re.compile(r"^\d{6}$")


def ok(data, meta=None):
    return {"ok": True, "data": data, "error": None,
            "meta": meta or {"source": "akshare", "fetchedAt": datetime.now().isoformat(timespec="seconds")}}


def err(kind, msg, meta=None):
    return {"ok": False, "data": None, "error": {"kind": kind, "msg": msg}, "meta": meta or {}}


def parse_codes(qs):
    raw = parse_qs(qs)
    codes = []
    for key in ("code", "codes"):
        for v in raw.get(key, []):
            codes += [c.strip() for c in v.split(",") if c.strip()]
    codes = [c[-6:] for c in codes if CODE_RE.match(c[-6:])]
    return list(dict.fromkeys(codes)), raw


class Handler(BaseHTTPRequestHandler):
    server_version = "StockTownLive/1.0"

    def _send(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        origin = self.headers.get("Origin", "")
        if origin in config.ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _check_token(self):
        # 预留：公网部署时在此校验访问令牌（如 self.headers.get("X-Token")），本地自用不启用
        return True

    def do_GET(self):
        try:
            self._route()
        except quotes.QuoteError as e:
            self._send(err(e.kind, e.msg))
        except Exception as e:
            traceback.print_exc()
            self._send(err("server", f"服务内部错误：{e}"), status=500)

    def _route(self):
        u = urlparse(self.path)
        path = u.path.rstrip("/")
        if path == "/api/health":
            self._send(ok(quotes.health()))
            return
        if not self._check_token():
            self._send(err("auth", "未授权"), status=401)
            return
        if path == "/api/calendar":
            self._send(ok(quotes.calendar_info()))
            return
        if path in ("/api/quote", "/api/quotes"):
            codes, _ = parse_codes(u.query)
            if not codes:
                self._send(err("bad_request", "缺少 code/codes 参数（6 位股票代码）"), status=400)
                return
            data, missing, meta = quotes.spot(codes)
            payload = ok({"quotes": data, "missing": missing}, meta)
            if missing and len(missing) == len(codes):
                payload = err("bad_code", f"未找到股票代码：{'、'.join(missing)}", meta)
            self._send(payload)
            return
        if path == "/api/history":
            codes, raw = parse_codes(u.query)
            if not codes:
                self._send(err("bad_request", "缺少 code 参数"), status=400)
                return
            days = int(raw.get("days", ["120"])[0] or 120)
            days = max(5, min(days, 800))
            adjust = raw.get("adjust", [""])[0]
            if adjust not in ("", "qfq", "hfq"):
                adjust = ""
            bars, meta = quotes.history(codes[0], days=days, adjust=adjust)
            self._send(ok({"code": codes[0], "bars": bars}, meta))
            return
        self._send(err("not_found", f"未知端点：{path}"), status=404)

    def log_message(self, fmt, *args):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {fmt % args}")


def main():
    print(f"股市小镇 · 本地行情服务  http://{config.HOST}:{config.PORT}")
    print("自检中（首次访问 AKShare 可能较慢）……")
    try:
        h = quotes.health()
        print(f"  AKShare {h['version']} 可用；今天 {h['today']} "
              f"{'是' if h['isTradeDay'] else '不是'}交易日，最近交易日 {h['lastTradeDate']}")
    except Exception as e:
        print(f"  警告：AKShare 自检失败（{e}）。服务仍会启动，前端将显示降级提示。")
    print("按 Ctrl+C 停止。")
    ThreadingHTTPServer((config.HOST, config.PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
