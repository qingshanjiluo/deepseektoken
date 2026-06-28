# 文档更新与示例完善计划

## 当前状态

项目已有基础的 README 和部署文档，但需要完善和补充更多文档。

## 文档更新内容

### 1. API 文档 (OpenAPI/Swagger)

创建 `docs/openapi.yaml` 文件，包含完整的 API 定义：

```yaml
openapi: 3.0.0
info:
  title: FreeDeepseekAPI
  version: 1.0.0
  description: OpenAI-compatible API proxy for DeepSeek

paths:
  /v1/chat/completions:
    post:
      summary: Chat completion
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                  enum: [deepseek-chat, deepseek-reasoner]
                messages:
                  type: array
                  items:
                    type: object
                    properties:
                      role:
                        type: string
                        enum: [system, user, assistant]
                      content:
                        type: string
                stream:
                  type: boolean
                sessionId:
                  type: string
              required:
                - model
                - messages
      responses:
        200:
          description: Successful response
        429:
          description: Rate limit exceeded
        503:
          description: No available accounts

  /v1/sessions:
    post:
      summary: Create session
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                account:
                  type: object
                metadata:
                  type: object
      responses:
        200:
          description: Session created
        400:
          description: Invalid request

  /v1/sessions/{sessionId}:
    get:
      summary: Get session
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: string
      responses:
        200:
          description: Session details
        404:
          description: Session not found

    delete:
      summary: Delete session
      parameters:
        - name: sessionId
          in: path
          required: true
          schema:
            type: string
      responses:
        200:
          description: Session deleted

  /health:
    get:
      summary: Health check
      responses:
        200:
          description: Service healthy

  /metrics:
    get:
      summary: Prometheus metrics
      responses:
        200:
          description: Metrics data
```

### 2. 使用示例

#### JavaScript/Node.js

```javascript
const response = await fetch('http://localhost:9655/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      { role: 'user', content: 'Hello, how are you?' }
    ],
    stream: false,
  }),
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

#### Python

```python
import requests

response = requests.post(
    'http://localhost:9655/v1/chat/completions',
    json={
        'model': 'deepseek-chat',
        'messages': [
            {'role': 'user', 'content': 'Hello, how are you?'}
        ],
        'stream': False,
    }
)

print(response.json()['choices'][0]['message']['content'])
```

#### cURL

```bash
curl -X POST http://localhost:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "stream": false
  }'
```

### 3. 部署配置示例

#### Docker Compose 完整配置

```yaml
version: '3.8'

services:
  api:
    build: .
    container_name: free-deepseek-api
    restart: unless-stopped
    ports:
      - "9655:9655"
    environment:
      - PORT=9655
      - HOST=0.0.0.0
      - DEEPSEEK_AUTH_PATH=/app/config/deepseek-auth.json
      - DEEPSEEK_ACCOUNT_COOLDOWN_MS=600000
      - LOG_LEVEL=info
      - NODE_ENV=production
    volumes:
      - ./config:/app/config
      - ./logs:/app/logs
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:9655/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    networks:
      - deepseek-network

  redis:
    image: redis:7-alpine
    container_name: deepseek-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    networks:
      - deepseek-network

networks:
  deepseek-network:
    driver: bridge

volumes:
  redis-data:
```

### 4. 故障排查指南

更新 `DEPLOY.md` 中的故障排查部分：

```markdown
## 常见问题及解决方案

### 1. 服务启动失败

**症状**：服务无法启动，日志显示端口被占用。

**解决方案**：
```bash
# 检查端口占用
netstat -tlnp | grep 9655

# 更换端口
export PORT=9656
npm start
```

### 2. 账号认证失败

**症状**：API 返回 401 或 403 错误。

**解决方案**：
- 检查 `deepseek-auth.json` 文件是否存在
- 验证 JSON 格式是否正确
- 确认 token 是否有效

### 3. 限速频繁触发

**症状**：频繁收到 429 错误。

**解决方案**：
- 检查限速配置
- 增加账号数量
- 调整冷却时间

### 4. 性能问题

**症状**：响应时间过长或超时。

**解决方案**：
- 启用集群模式
- 使用 Redis 存储会话
- 增加内存限制
```

### 5. 性能调优指南

```markdown
## 性能调优指南

### 1. 系统级别
- 使用 Node.js 18+ 版本
- 增加系统文件描述符限制
- 调整内核参数

### 2. 应用级别
- 启用集群模式
- 使用 Redis 缓存
- 优化日志级别

### 3. 网络级别
- 使用 Nginx 作为反向代理
- 启用 HTTP/2
- 配置负载均衡
```

## 执行计划

### 短期 (1 天)
1. 生成 OpenAPI 文档
2. 添加使用示例

### 中期 (2-3 天)
1. 完善部署配置
2. 更新故障排查指南

### 长期 (1 周)
1. 添加性能调优指南
2. 创建视频教程
3. 翻译文档为其他语言