# 📋 配置指南

本文档将指导你完成整个项目的部署配置。

## 📝 目录

1. [部署 Cloudflare Worker](#1-部署-cloudflare-worker)
2. [配置 GitHub Secrets](#2-配置-github-secrets)
3. [测试运行](#3-测试运行)
4. [常见问题](#4-常见问题)

---

## 1. 部署 Cloudflare Worker

### 步骤 1.1: 创建 Cloudflare Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** 
3. 点击 **Create Application** → **Create Worker**
4. 给 Worker 命名，例如：`sky-daily-task`
5. 点击 **Deploy**

### 步骤 1.2: 上传 Worker 代码

1. 在创建的 Worker 页面，点击 **Quick Edit**
2. 删除默认代码，复制粘贴 `worker.js` 的全部内容
3. 点击 **Save and Deploy**

### 步骤 1.3: 配置环境变量

在 Worker 设置页面：

1. 点击 **Settings** → **Variables**
2. 添加以下环境变量：

⚠️ **重要：所有环境变量都必须配置，代码中没有默认值**

#### 账号信息变量

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `SKY_UID` | 你的光遇用户ID | `your_uid` |
| `SKY_GAME_UID` | 你的游戏UID | `123456789` |
| `SKY_GAME_SERVER` | 游戏服务器 | `8000` |
| `API_SECRET` | API 访问密钥 | 自己生成的随机字符串 |

#### 缓存配置变量

| 变量名 | 说明 | 推荐值 |
|--------|------|--------|
| `CACHE_TTL` | 缓存时长(秒) | `3600` |

#### 网易 API 配置变量

| 变量名 | 说明 | 值 |
|--------|------|-----|
| `NETEASE_TOKEN_API` | 获取 token 的 API |
| `NETEASE_TASK_API` | 获取每日任务的 API |
| `NETEASE_EVENT_API` | 获取活动数据的 API | 
| `NETEASE_WEATHER_API` | 获取天气预报的 API (可选) |
| `NETEASE_TASK_ORIGIN` | 任务 API Origin 头 |
| `NETEASE_TASK_REFERER` | 任务 API Referer 头 | 
| `NETEASE_USER_AGENT` | User-Agent 请求头 | 
| `NETEASE_TOKEN_HOST` | Token API Host 头 |

#### 如何获取 SKY_UID 和 SKY_GAME_UID？


```python
uid = "your_uid"  # 替换为你的实际 UID
game_uid = "123456789"  # 替换为你的实际 game_uid
```

直接复制这些值到 Cloudflare 环境变量中。

#### 如何生成 API_SECRET？

使用在线工具生成一个 32 位以上的随机字符串。

#### 配置说明

⚠️ **所有变量都必须配置：**
- 代码中已移除所有默认值
- 缺少任何一个变量都会导致 Worker 报错
- 这样做是为了确保所有配置都显式指定，提高安全性

💡 **为什么要这样设计：**
- 避免代码中硬编码敏感的 API 地址
- 提高灵活性，可以随时更换 API 而不修改代码
- 所有配置集中管理，更易维护

3. 点击 **Save**

### 步骤 1.4: 获取 Worker URL

1. 回到 Worker 概览页面
2. 复制 Worker 的 URL，格式类似：`https://sky-daily-task.你的用户名.workers.dev`
3. **保存这个 URL，后面需要用到**

### 步骤 1.5: 测试 Worker

在 PowerShell 中测试（替换 URL 和 API_SECRET）：

```powershell
$headers = @{
    "Authorization" = "Bearer 你的API_SECRET"
}

Invoke-RestMethod -Uri "https://你的worker.workers.dev" -Headers $headers -Method Get
```

如果返回包含 `success: true` 的 JSON 数据，说明配置成功！

---

## 2. 配置 GitHub Secrets

### 步骤 2.1: 添加 Secrets

1. 打开你的 GitHub 仓库
2. 进入 **Settings** → **Secrets and variables** → **Actions**
3. 点击 **New repository secret**
4. 添加以下两个 Secret：

| Secret 名称 | 值 |
|------------|-----|
| `WORKER_URL` | 你的 Cloudflare Worker URL（步骤 1.4 获取的） |
| `API_SECRET` | 你在 Cloudflare 中设置的 API_SECRET（与步骤 1.3 中的相同） |

**⚠️ 重要提示：**
- `API_SECRET` 必须与 Cloudflare Worker 中设置的完全一致
- `WORKER_URL` 必须是完整的 HTTPS 链接

---

## 3. 测试运行

### 步骤 3.1: 手动触发 GitHub Actions

1. 进入仓库的 **Actions** 标签页
2. 选择 **更新光遇每日任务** workflow
3. 点击 **Run workflow** → **Run workflow**
4. 等待运行完成（约 10-30 秒）

### 步骤 3.2: 检查结果

1. 运行成功后，查看 README.md
2. 应该能看到最新的每日任务和活动信息
3. 检查 commit 历史，应该有一条新的自动提交

---

## 4. 常见问题

### ❓ Worker 返回 401 错误

**原因：** API_SECRET 不匹配

**解决：** 确保 GitHub Secrets 中的 `API_SECRET` 与 Cloudflare Worker 环境变量中的完全一致

### ❓ Worker 返回 500 错误

**原因：** 可能是获取 token 失败或 UID 配置错误

**解决：**
1. 检查 Cloudflare Worker 的环境变量是否正确设置
2. 在 Cloudflare Dashboard 中查看 Worker 的实时日志（Logs 标签）
3. 验证 `SKY_UID` 和 `SKY_GAME_UID` 是否有效

### ❓ GitHub Actions 运行失败

**原因：** Secrets 未配置或 Worker URL 错误

**解决：**
1. 检查 GitHub Secrets 是否都已添加
2. 验证 `WORKER_URL` 是否正确（可以在浏览器中访问测试）
3. 查看 Actions 的详细日志找出具体错误

### ❓ README 没有更新

**原因：** 可能是 git push 权限问题

**解决：**
1. 确保 workflow 文件中使用了 `secrets.GITHUB_TOKEN`
2. 检查仓库 Settings → Actions → General → Workflow permissions
3. 确保选择了 **Read and write permissions**

### ❓ Token 过期怎么办？

**不用担心！** Worker 会在每次请求时自动重新获取新的 token，你不需要手动维护。

### ❓ 缓存是如何工作的？

Worker 使用 Cloudflare Cache API 缓存每日数据：
- **缓存键**: 基于日期 (`sky-daily-YYYY-MM-DD`)，每天自动更新
- **缓存时长**: 默认 1 小时 (可通过 `CACHE_TTL` 环境变量调整)
- **自动刷新**: 每天首次请求会自动获取新数据
- **保护机制**: 避免频繁请求 API，防止账号被封

**缓存测试**:
```powershell
# 正常请求（使用缓存）
python test_worker.py

# 或手动测试
$headers = @{ "Authorization" = "Bearer 你的API_SECRET" }
Invoke-RestMethod -Uri "https://你的worker.workers.dev" -Headers $headers
```

### ❓ 如何强制刷新缓存？

在 URL 后添加 `?refresh=true` 参数：
```powershell
# GitHub Actions 中
WORKER_URL: ${{ secrets.WORKER_URL }}?refresh=true

# 或手动测试
Invoke-RestMethod -Uri "https://你的worker.workers.dev?refresh=true" -Headers $headers
```

### ❓ 缓存会占用多少空间？

每天的缓存数据约 5-10 KB，Cloudflare Workers 免费版提供充足的缓存空间，完全够用。

### ❓ 如何调整缓存时长？

在 Cloudflare Worker 环境变量中设置 `CACHE_TTL`：
- `3600` = 1 小时（推荐）
- `7200` = 2 小时
- `86400` = 24 小时（不推荐，任务可能更新不及时）

### ❓ 如何修改更新时间？

编辑 `.github/workflows/update-daily.yml` 中的 cron 表达式：

```yaml
schedule:
  # 当前设置：每天 UTC 0:00 (北京时间 8:00)
  - cron: '0 0 * * *'
  
  # 改为每天 UTC 12:00 (北京时间 20:00)
  - cron: '0 12 * * *'
```

---

## 5. 安全说明

✅ **安全的做法（本项目）：**
- 所有敏感信息（UID、game_uid）存储在 Cloudflare Worker 环境变量中
- API 调用通过 Worker 中转，不直接暴露接口
- GitHub 仅存储 Worker URL 和 API 密钥
- 所有敏感数据都不会出现在代码仓库中

❌ **不安全的做法：**
- 将 UID、token 直接写在代码中
- 将网易 API 地址直接暴露在 GitHub Actions 中
- 在公开仓库中存储敏感配置

---

## 6. 维护建议

- 定期检查 GitHub Actions 运行日志
- 如果长时间未更新，检查 Worker 是否正常运行
- 建议启用 GitHub Actions 的邮件通知
- 如果更换账号，只需更新 Cloudflare Worker 的环境变量即可

---

## 📞 需要帮助？

如果遇到问题，请：

1. 查看 GitHub Actions 的运行日志
2. 查看 Cloudflare Worker 的实时日志
3. 在仓库中提交 Issue

---

**祝你使用愉快！🎉**
