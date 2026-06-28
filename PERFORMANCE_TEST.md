# 性能测试与调优计划

## 测试目标

验证 FreeDeepseekAPI 在高并发场景下的性能表现，识别瓶颈并进行优化。

## 测试环境

### 硬件配置
- CPU: 4 核心
- 内存: 8GB
- 网络: 千兆以太网

### 软件配置
- Node.js: 18.x
- 操作系统: Ubuntu 22.04 LTS
- 测试工具: autocannon, k6

## 测试场景

### 1. 基本性能测试

**目标**：测试 API 的基本响应能力

**场景**：
- 并发用户数: 10, 50, 100
- 请求数: 1000 次
- 测试端点: `/health`, `/v1/models`, `/v1/chat/completions`

**指标**：
- 响应时间 (平均, p95, p99)
- 吞吐量 (req/s)
- 错误率

### 2. 限速测试

**目标**：验证限速机制的有效性

**场景**：
- 并发用户数: 100
- 请求数: 5000 次
- 模型: deepseek-chat (60 req/min)

**指标**：
- 限速触发次数
- 429 响应比例
- 平均等待时间

### 3. 会话管理测试

**目标**：测试会话创建和复用的性能

**场景**：
- 创建 1000 个会话
- 每个会话发起 10 次请求
- 启用/禁用会话复用

**指标**：
- 会话创建耗时
- 会话复用命中率
- 内存使用情况

### 4. 账号池测试

**目标**：验证账号池切换和冷却机制

**场景**：
- 账号数量: 10
- 并发请求: 200
- 模拟账号失败和冷却

**指标**：
- 账号切换次数
- 冷却触发次数
- 账号可用性

## 测试执行

### 安装测试工具

```bash
npm install -g autocannon
npm install -g k6
```

### 运行测试脚本

```bash
# 基本性能测试
autocannon -c 100 -d 30 http://localhost:9655/health

# 限速测试
autocannon -c 100 -d 30 -m POST -H "Content-Type: application/json" -b '{"model":"deepseek-chat","messages":[{"role":"user","content":"Hello"}]}' http://localhost:9655/v1/chat/completions

# 使用 k6 运行复杂场景
k6 run tests/performance/load-test.js
```

## 性能优化建议

### 1. Node.js 优化

```javascript
// 增加内存限制
node --max-old-space-size=4096 src/server/index.js

// 启用 V8 优化
node --optimize-for-size --max-old-space-size=4096 src/server/index.js
```

### 2. 集群模式

```javascript
// 启用集群模式
const clusterManager = new ClusterManager({ enabled: true, workers: 4 });
```

### 3. 缓存优化

```javascript
// 使用 Redis 缓存会话
const sessionStore = new SessionStore({ storeType: 'redis' });
```

### 4. 连接池优化

```javascript
// 优化 HTTP 连接池
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
});
```

### 5. 数据库优化

- 使用 Redis 作为会话存储
- 实现会话过期策略
- 使用批量操作减少数据库连接

## 性能基准

### 预期性能指标

| 指标 | 目标值 | 当前值 |
|------|--------|--------|
| 平均响应时间 (健康检查) | < 10ms | - |
| 平均响应时间 (聊天补全) | < 500ms | - |
| p95 响应时间 | < 1s | - |
| 吞吐量 | > 1000 req/s | - |
| 错误率 | < 0.1% | - |
| 内存使用 | < 500MB | - |
| CPU 使用 | < 80% | - |

### 性能监控

```bash
# 实时监控
pm2 monit

# 查看日志
pm2 logs free-deepseek-api

# 查看指标
curl http://localhost:9655/metrics
```

## 调优步骤

1. **基准测试**: 执行性能测试，记录当前指标
2. **瓶颈分析**: 识别性能瓶颈 (CPU, 内存, I/O)
3. **优化实施**: 根据分析结果进行优化
4. **验证测试**: 重新执行测试，验证改进效果
5. **迭代优化**: 重复步骤 2-4，直到达到目标

## 常见问题及解决方案

### 1. 响应时间过长
- 检查数据库连接
- 增加缓存
- 优化代码逻辑

### 2. 内存泄漏
- 检查会话清理机制
- 使用 heapdump 分析内存
- 定期重启服务

### 3. CPU 使用率过高
- 启用集群模式
- 优化算法复杂度
- 减少不必要的计算

## 监控告警

### 关键指标
- 响应时间 > 1s
- 错误率 > 1%
- 内存使用 > 80%
- CPU 使用 > 90%

### 告警配置
```yaml
groups:
  - name: api_alerts
    rules:
      - alert: HighResponseTime
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
        for: 5m
        annotations:
          summary: "API response time is high"
      - alert: HighErrorRate
        expr: rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.01
        for: 5m
        annotations:
          summary: "API error rate is high"