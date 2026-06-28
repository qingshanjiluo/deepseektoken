# FreeDeepseekAPI 部署指南

本文档介绍如何将 FreeDeepseekAPI 部署到生产服务器。

## 部署方式

### 方式一：Docker Compose (推荐)

最简单的部署方式，适合大多数场景。

#### 1. 准备配置文件

```bash
# 创建配置目录
mkdir -p config logs

# 复制认证文件
cp /path/to/deepseek-auth.json config/

# 创建 .env 文件 (可选)
cat > .env << EOF
PORT=9655
HOST=0.0.0.0
DEEPSEEK_AUTH_PATH=/app/config/deepseek-auth.json
DEEPSEEK_ACCOUNT_COOLDOWN_MS=600000
LOG_LEVEL=info
EOF
```

#### 2. 启动服务

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

#### 3. 验证服务

```bash
curl http://localhost:9655/health
```

### 方式二：直接部署 (Node.js)

适合需要直接控制运行环境的场景。

#### 1. 安装依赖

```bash
npm install --production
```

#### 2. 配置环境

```bash
# 复制配置
cp deepseek-auth.json config/

# 设置环境变量
export PORT=9655
export HOST=0.0.0.0
export DEEPSEEK_AUTH_PATH=./config/deepseek-auth.json
export NODE_ENV=production
export LOG_LEVEL=info
```

#### 3. 启动服务

```bash
# 使用启动脚本
chmod +x scripts/start.sh
./scripts/start.sh start

# 或直接运行
node src/server/index.js
```

#### 4. 管理服务

```bash
# 查看状态
./scripts/start.sh status

# 查看日志
./scripts/start.sh logs

# 重启服务
./scripts/start.sh restart

# 停止服务
./scripts/start.sh stop
```

### 方式三：使用 PM2

适合需要进程管理和自动重启的场景。

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start src/server/index.js --name free-deepseek-api

# 设置开机自启
pm2 startup
pm2 save

# 查看状态
pm2 status
pm2 logs free-deepseek-api
```

## Nginx 反向代理

如果需要通过域名访问或需要 HTTPS，可以使用 Nginx 作为反向代理。

### 1. 复制配置

```bash
cp nginx.conf.example /etc/nginx/sites-available/free-deepseek-api
```

### 2. 修改配置

编辑 `/etc/nginx/sites-available/free-deepseek-api`，将 `your-domain.com` 替换为实际域名。

### 3. 启用配置

```bash
ln -s /etc/nginx/sites-available/free-deepseek-api /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## 环境变量配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| PORT | 服务端口 | 9655 |
| HOST | 监听地址 | 0.0.0.0 |
| DEEPSEEK_AUTH_PATH | 认证文件路径 | ./deepseek-auth.json |
| DEEPSEEK_ACCOUNT_COOLDOWN_MS | 账号冷却时间 (毫秒) | 600000 |
| LOG_LEVEL | 日志级别 (debug/info/warn/error) | info |
| NODE_ENV | 运行环境 (production/development) | development |

## 账号配置

`deepseek-auth.json` 格式：

```json
[
  {
    "token": "your-deepseek-token-1",
    "email": "account1@example.com"
  },
  {
    "token": "your-deepseek-token-2",
    "email": "account2@example.com"
  }
]
```

## 健康检查

服务提供 `/health` 端点用于健康检查：

```bash
curl http://localhost:9655/health
```

响应示例：
```json
{
  "status": "ok",
  "accounts": 5,
  "available": 3,
  "sessions": {
    "totalSessions": 12,
    "reuseEnabled": true,
    "maxSessions": 1000
  }
}
```

## 故障排查

### 端口占用

```bash
# 查看端口占用
netstat -tlnp | grep 9655

# 更换端口
export PORT=9656
```

### 认证文件问题

```bash
# 检查文件是否存在
ls -la config/deepseek-auth.json

# 验证 JSON 格式
cat config/deepseek-auth.json | jq .
```

### 日志位置

- Docker: `docker-compose logs`
- 直接部署: `logs/production.log`
- PM2: `pm2 logs free-deepseek-api`

## 性能调优

### Node.js 参数

```bash
# 增加内存限制
node --max-old-space-size=4096 src/server/index.js
```

### 并发配置

在 `src/server/index.js` 中调整：

```javascript
// 会话数量
const sessionManager = new SessionManager({ 
  maxSessions: 2000,
  defaultTTL: 7200000  // 2小时
});

// 限速配置
const rateLimiter = new RateLimiter({
  limits: {
    'deepseek-chat': { requestsPerMinute: 120 },
    'deepseek-reasoner': { requestsPerMinute: 60 },
  }
});
```

## 监控建议

- 使用 `pm2 monit` 监控资源使用
- 使用 `curl` 定期检查健康端点
- 监控 `logs/` 目录下的错误日志
- 关注账号池可用数量 (`/health` 端点)