# 磁盘缓存：server/cache/ 下的 JSON 文件
# - 快照/日历：短 TTL
# - 历史日线：最后一个 bar 已覆盖「最近已完成交易日」即视为最终数据，不再抓取
import json
import os
import time
from datetime import datetime

import config

_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), config.CACHE_DIR)
os.makedirs(_dir, exist_ok=True)


def _path(name):
    return os.path.join(_dir, name + ".json")


def read(name):
    try:
        with open(_path(name), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def write(name, payload):
    payload = dict(payload)
    payload["fetchedAt"] = datetime.now().isoformat(timespec="seconds")
    try:
        with open(_path(name), "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
    except Exception:
        pass  # 缓存写失败不阻塞服务


def fresh(entry, ttl_sec):
    """通用 TTL 判断。"""
    if not entry or "fetchedAt" not in entry:
        return False
    try:
        t = datetime.fromisoformat(entry["fetchedAt"]).timestamp()
    except Exception:
        return False
    return (time.time() - t) < ttl_sec
