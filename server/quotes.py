# AKShare 调用封装：交易日历、当日快照、个股日线历史
# 所有上游请求只发生在本模块；失败时抛 QuoteError，由 app.py 统一分类返回
import math
import re
from datetime import datetime, time as dtime

import cache
import config


class QuoteError(Exception):
    def __init__(self, kind, msg):
        super().__init__(msg)
        self.kind = kind  # 'upstream' | 'bad_code'
        self.msg = msg


def _ak():
    try:
        import akshare as ak
        return ak
    except Exception as e:
        raise QuoteError("upstream", f"akshare 不可用：{e}")


def _clean(v):
    """NaN/inf → None（如停牌股票的最新价）。"""
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None


# ---------- 交易日历 ----------
def trade_dates():
    """返回升序的交易日列表 ['YYYY-MM-DD', ...]，当日缓存。"""
    entry = cache.read("calendar")
    today = datetime.now().strftime("%Y-%m-%d")
    if entry and entry.get("day") == today and entry.get("dates"):
        return entry["dates"]
    ak = _ak()
    try:
        df = ak.tool_trade_date_hist_sina()
    except Exception as e:
        if entry and entry.get("dates"):
            return entry["dates"]  # 日历变化极慢，旧缓存可兜底
        raise QuoteError("upstream", f"交易日历获取失败：{e}")
    dates = sorted(str(d)[:10] for d in df["trade_date"])
    cache.write("calendar", {"day": today, "dates": dates})
    return dates


def calendar_info():
    dates = trade_dates()
    today = datetime.now().strftime("%Y-%m-%d")
    past = [d for d in dates if d <= today]
    last = past[-1] if past else None
    return {
        "today": today,
        "isTradeDay": today in dates,
        "lastTradeDate": last,
        "recent": past[-15:],
    }


def latest_completed_trade_date(now=None):
    """最近一个「已完成」的交易日：今天若是交易日且已过 15:05 则算今天，否则取上一个交易日。"""
    now = now or datetime.now()
    info = calendar_info()
    today = info["today"]
    if info["isTradeDay"] and now.time() >= dtime(15, 5):
        return today
    before = [d for d in info["recent"] if d < today]
    return before[-1] if before else info["lastTradeDate"]


# ---------- 当日快照 ----------
# 主源：新浪 hq.sinajs.cn（批量一次请求，含数据时间戳）；兜底：东财全市场快照
def _fetch_spot_sina(codes):
    import requests
    syms = [("sh" if c[0] == "6" else "sz") + c for c in codes]
    try:
        r = requests.get(
            "https://hq.sinajs.cn/list=" + ",".join(syms),
            headers={"Referer": "https://finance.sina.com.cn"},
            timeout=config.UPSTREAM_TIMEOUT_SEC,
        )
        r.encoding = "gbk"
        text = r.text
    except Exception as e:
        raise QuoteError("upstream", f"行情快照获取失败（新浪源）：{e}")
    at = datetime.now().isoformat(timespec="seconds")
    out = {}
    for c, sym in zip(codes, syms):
        m = re.search(rf'var hq_str_{sym}="([^"]*)"', text)
        if not m or not m.group(1):
            continue  # 无数据 → 视为代码不存在
        f = m.group(1).split(",")
        if len(f) < 10:
            continue
        price = _clean(f[3])
        prev = _clean(f[2])
        if not price:  # 停牌时最新价为 0
            price = None
        out[c] = {
            "code": c,
            "name": f[0],
            "price": price,
            "pct": round((price - prev) / prev * 100, 2) if price and prev else None,
            "open": _clean(f[1]) or None,
            "high": _clean(f[4]) or None,
            "low": _clean(f[5]) or None,
            "prevClose": prev,
            "volume": _clean(f[8]),
            "amount": _clean(f[9]),
            "dataTime": f"{f[30]} {f[31]}" if len(f) > 31 else None,
            "_at": at,
        }
    return out


def _fetch_spot_eastmoney(codes):
    ak = _ak()
    try:
        df = ak.stock_zh_a_spot_em()
    except Exception as e:
        raise QuoteError("upstream", f"行情快照获取失败（东财源）：{e}")
    at = datetime.now().isoformat(timespec="seconds")
    want = set(codes)
    out = {}
    for _, r in df.iterrows():
        code = str(r.get("代码", ""))[-6:]
        if code not in want:
            continue
        out[code] = {
            "code": code,
            "name": str(r.get("名称", "")),
            "price": _clean(r.get("最新价")),
            "pct": _clean(r.get("涨跌幅")),
            "open": _clean(r.get("今开")),
            "high": _clean(r.get("最高")),
            "low": _clean(r.get("最低")),
            "prevClose": _clean(r.get("昨收")),
            "volume": _clean(r.get("成交量")),
            "amount": _clean(r.get("成交额")),
            "dataTime": None,
            "_at": at,
        }
    return out


def spot(codes):
    """返回 (data, missing, meta)。按代码分别缓存 60 秒；抓取失败时用过期缓存兜底（stale）。"""
    entry = cache.read("spot") or {}
    cached_all = entry.get("data", {})

    def fresh(q):
        if not q or "_at" not in q:
            return False
        try:
            return (datetime.now() - datetime.fromisoformat(q["_at"])).total_seconds() < config.SPOT_TTL_SEC
        except Exception:
            return False

    need = [c for c in codes if not fresh(cached_all.get(c))]
    stale = False
    if need:
        got = {}
        err_msg = None
        for fetcher in (_fetch_spot_sina, _fetch_spot_eastmoney):
            try:
                got = fetcher(need)
                err_msg = None
                break
            except QuoteError as e:
                err_msg = e.msg
        if got:
            cached_all.update(got)
            cache.write("spot", {"data": cached_all})
        elif err_msg:
            if all(c in cached_all for c in need):
                stale = True  # 过期缓存兜底
            else:
                raise QuoteError("upstream", err_msg)
    data, missing = {}, []
    for c in codes:
        q = cached_all.get(c)
        if q:
            data[c] = {k: v for k, v in q.items() if not k.startswith("_")}
            if not fresh(q):
                stale = True
        else:
            missing.append(c)
    ats = [cached_all[c]["_at"] for c in data if "_at" in cached_all[c]]
    meta = {
        "source": "akshare",
        "fetchedAt": max(ats) if ats else None,
        "cached": not need,
        "stale": stale,
    }
    return data, missing, meta


# ---------- 个股日线历史 ----------
# 主源：东财 kline；兜底：新浪日线（ak.stock_zh_a_daily，同样支持复权）
def _hist_eastmoney(code, adjust):
    ak = _ak()
    df = ak.stock_zh_a_hist(symbol=code, period="daily",
                            start_date="19900101", end_date="20991231",
                            adjust=adjust or "")
    if df is None or df.empty:
        raise QuoteError("bad_code", f"未找到股票代码 {code} 的历史行情")
    bars = []
    for _, r in df.iterrows():
        c = _clean(r.get("收盘"))
        if c is None:
            continue
        bars.append({
            "date": str(r.get("日期"))[:10],
            "open": _clean(r.get("开盘")),
            "close": c,
            "high": _clean(r.get("最高")),
            "low": _clean(r.get("最低")),
            "volume": _clean(r.get("成交量")) or 0,
        })
    return bars


def _hist_sina(code, adjust):
    ak = _ak()
    symbol = ("sh" if code[0] == "6" else "sz") + code
    df = ak.stock_zh_a_daily(symbol=symbol, adjust=adjust or "")
    if df is None or df.empty:
        raise QuoteError("bad_code", f"未找到股票代码 {code} 的历史行情")
    bars = []
    for _, r in df.iterrows():
        c = _clean(r.get("close"))
        if c is None:
            continue
        bars.append({
            "date": str(r.get("date"))[:10],
            "open": _clean(r.get("open")),
            "close": c,
            "high": _clean(r.get("high")),
            "low": _clean(r.get("low")),
            "volume": _clean(r.get("volume")) or 0,
        })
    return bars


def history(code, days=120, adjust=""):
    """返回 (bars, meta)。bars: [{date, open, close, high, low, volume}, ...] 升序，仅到最近已完成交易日。
    缓存策略：已覆盖最近已完成交易日 → 直接复用；否则抓全量并重写。"""
    name = f"hist_{code}_{adjust or 'none'}"
    entry = cache.read(name)
    try:
        completed = latest_completed_trade_date()
    except QuoteError:
        completed = None
    if entry and entry.get("bars"):
        bars = entry["bars"]
        fresh_enough = completed and bars[-1]["date"] >= completed
        recent = cache.fresh(entry, config.HIST_REFETCH_MIN_SEC)
        if fresh_enough or recent:
            return bars[-days:], _meta(entry, cached=True, stale=not fresh_enough and not recent, adjust=adjust)
    bars = None
    errs = []
    for fetcher in (_hist_eastmoney, _hist_sina):
        try:
            bars = fetcher(code, adjust)
            break
        except QuoteError as e:
            if e.kind == "bad_code":
                raise
            errs.append(e.msg)
        except Exception as e:
            errs.append(str(e))
    if bars is None:
        if entry and entry.get("bars"):
            return entry["bars"][-days:], _meta(entry, cached=True, stale=True, adjust=adjust)
        raise QuoteError("upstream", f"历史行情获取失败：{'；'.join(errs)}")
    if not bars:
        raise QuoteError("bad_code", f"未找到股票代码 {code} 的历史行情")
    if completed:
        bars = [b for b in bars if b["date"] <= completed]
    cache.write(name, {"bars": bars})
    return bars[-days:], _meta(cache.read(name), cached=False, stale=False, adjust=adjust)


def _meta(entry, cached, stale, adjust=""):
    return {
        "source": "akshare",
        "fetchedAt": entry.get("fetchedAt") if entry else None,
        "cached": cached,
        "stale": stale,
        "adjust": adjust or "none",
    }


# ---------- 自检 ----------
def health():
    ak = _ak()
    info = calendar_info()
    import akshare
    return {
        "akshare": True,
        "version": getattr(akshare, "__version__", "?"),
        "today": info["today"],
        "isTradeDay": info["isTradeDay"],
        "lastTradeDate": info["lastTradeDate"],
        "time": datetime.now().isoformat(timespec="seconds"),
    }
