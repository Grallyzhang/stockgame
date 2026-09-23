# 本地行情服务（第三阶段 · 实时模拟）

为前端提供 A 股行情，数据来自 AKShare（公开数据源封装，仅供学习研究，不构成投资建议）。

## 一次性准备

```
pip install -r server/requirements.txt
```

（如超时：`pip install -r server/requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple`）

## 启动

```
python server/app.py
```

默认 http://127.0.0.1:8500 ，启动时会自动自检 AKShare 可用性并打印结果。

## 端点

- `GET /api/health` — 服务与 AKShare 自检
- `GET /api/calendar` — 今日是否交易日、最近交易日
- `GET /api/quote?code=600519` / `GET /api/quotes?codes=600519,000001` — 当日快照（60 秒缓存）
- `GET /api/history?code=600519&days=120&adjust=qfq` — 日线（adjust 可选 空/qfq/hfq）

所有响应为 `{ ok, data, error, meta }`；`meta` 含 source、fetchedAt、cached、stale。

缓存目录 `server/cache/`（可整个删除，会自动重建）。
