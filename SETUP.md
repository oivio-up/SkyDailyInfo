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

> 仓库中的 GitHub Actions 只会调用 Worker，不会自动部署 `worker.js`。以后该文件有更改时，需要在 Cloudflare 重新保存并部署。

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

不要把密钥交给在线随机字符串网站。在本机生成至少 32 字节的随机密钥：

```powershell
# PowerShell（需要 Python）
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

将输出分别保存到 Cloudflare Worker 的 `API_SECRET` 和 GitHub Actions 的同名 Secret，不要将真实值写入代码、Issue 或日志。

#### 配置说明

⚠️ **所有变量都必须配置：**
- 代码中已移除所有默认值
- 缺少任何一个变量都会导致 Worker 报错
- 这样做是为了确保所有配置都显式指定，提高安全性

💡 **为什么要这样设计：**
- 避免代码中硬编码敏感的 API 地址
- 提高灵活性，可以随时更换 API 而不修改代码
- 所有配置集中管理，更易维护

`CACHE_TTL` 只接受 60–86400 秒。Worker 会在处理请求时校验所有必需配置；配置不完整时返回通用的 503，具体缺少项只写入 Worker 日志。

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

### ❓ 图片显示 “Cannot proxy the given URL”

这是 GitHub Camo 无法代理外部图片时的错误，不一定代表网易原图失效。更新脚本现在会把天气、日历和任务图片下载到 `assets/daily/`，README 使用仓库相对路径；Actions 会将图片与 README 一起提交。

- 相同 URL 的已有图片直接复用，下载有超时、重试和 10 MiB 大小限制。
- 根据文件内容识别 PNG/JPEG/GIF/WebP，不依赖上游可能异常的 Content-Type。
- 下载失败时保留可点击的原图链接；其他任务信息仍会更新。
- README 写入成功后清理当前不再引用的自动生成图片，手工添加的文件保留。Git 历史仍会保留旧版本。

### ❓ 攻略里混入“拯救小精灵”等推广

现在按每日任务正文的结构选择问答链接：查询前四项任务行中的链接，并保留季节蜡烛、大蜡烛及碎片的相关指南。正文其他位置的推广即使换了名称也不会成为任务攻略；攻略中的“小精灵提示”等有效说明继续保留。

Python 更新端会对旧 Worker 返回的详情做相同筛选，因此同步 GitHub 后即可生效。将新版 `worker.js` 重新部署到 Cloudflare 后，还能避免请求这些推广详情。新版缓存键包含 `v2`，不会复用旧解析结果。

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
- Worker 只接受 `GET` / `OPTIONS`，认证摘要使用完整比较，不会把内部异常返回给调用方

❌ **不安全的做法：**
- 将 UID、token 直接写在代码中
- 将网易 API 地址直接暴露在 GitHub Actions 中
- 在公开仓库中存储敏感配置

如果 Worker URL 对外大量暴露，可在 Cloudflare 配置 Rate Limiting。不要在 Worker 内用普通全局变量计数：isolate 会重启且多地分布，这种计数不可靠。对本项目这类单一定时调用，高强度随机 `API_SECRET` 是首要措施。

---

## 6. 维护建议

- 定期检查 GitHub Actions 运行日志
- 如果长时间未更新，检查 Worker 是否正常运行
- 建议启用 GitHub Actions 的邮件通知
- 如果更换账号，只需更新 Cloudflare Worker 的环境变量即可

### 本地回归测试

```powershell
python -m pip install --requirement requirements.txt
python -m unittest discover -s tests -p "test_*.py"
node --test tests/worker.test.js
```

GitHub Actions 会在请求 Worker 和改写 README 之前运行同样的测试。

## 7. GitHub Pages 网页

网页地址：**https://oivio-up.github.io/SkyDailyInfo/**。每天获取数据成功后，`部署光遇旅行手册` 工作流会自动更新网页。修改前端并推送到 `main` 时也会自动部署。

网页的任务勾选只保存在当前浏览器中，不会发送到服务器。图片使用仓库内文件，也可以点击打开网易原图。

### 只更新网页，保留 README

在仓库 **Settings → Secrets and variables → Actions → Variables** 中添加 Repository variable：

| 名称 | 值 | 行为 |
| --- | --- | --- |
| `UPDATE_README` | `false` | 每日只更新网页数据，README 保留现有内容 |
| `UPDATE_README` | `true` 或不设置 | 网页和 README 同时更新 |

如果之后希望从 README 删除每日内容，可以删除 `DAILY_TASK_START` 与 `DAILY_TASK_END` 之间的区域，同时将此变量设为 `false`，保留上面的网页入口链接即可。

### 部署与数据范围

GitHub **Settings → Pages → Source** 使用 **GitHub Actions**。构建时只打包 `site/` 中的五个前端/数据文件与 `assets/daily/` 图片，不发布 Python 脚本、Worker 代码或配置。

`site/data.json` 使用固定公开字段：日期、更新时间、任务、天气、月历、攻略和活动。不会直接发布 Worker 原始 JSON、原始回答或环境变量。网页不请求私有 Worker，`WORKER_URL`、`API_SECRET` 和游戏 UID 不进入前端。

部署工作流通过 `workflow_run` 跟随每日更新，因为 GitHub Actions 自带 Token 的提交不会再次触发普通 `push` 工作流。可在 Actions 中手动运行 `部署光遇旅行手册` 重新发布。

---

## 📞 需要帮助？

如果遇到问题，请：

1. 查看 GitHub Actions 的运行日志
2. 查看 Cloudflare Worker 的实时日志
3. 在仓库中提交 Issue

---

**祝你使用愉快！🎉**
