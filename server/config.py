# 本地行情服务配置
# 预留：日后公网部署时，把 HOST 改为 0.0.0.0，并在 app.py 的 _check_token 里启用访问令牌校验
HOST = "127.0.0.1"
PORT = 8500

# 允许的前端来源（CORS）
ALLOWED_ORIGINS = {
    "http://127.0.0.1:8137",
    "http://localhost:8137",
}

# 缓存
CACHE_DIR = "cache"
SPOT_TTL_SEC = 60          # 当日快照缓存 60 秒
HIST_REFETCH_MIN_SEC = 60  # 历史数据距上次抓取的最短间隔（避免频繁请求上游）

# 请求上游超时
UPSTREAM_TIMEOUT_SEC = 15

# 数据源开关（预留替换点）：当前仅实现 akshare
DATA_SOURCE = "akshare"
