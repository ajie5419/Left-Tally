# Grand Comptroller

履约管理系统。当前处于工程初始化阶段（BOOTSTRAP）：已有最小前后端、共享契约和检查门禁，尚无正式业务功能。

## 先读这些

| 文档 | 用途 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 工作方式：业务验收优先、Git 与 PR 规则、禁止事项 |
| [需求基线](Grand%20Comptroller/需求基线-2026-10-13.md) | 业务需求范围 |
| [第一条业务链验收场景](Grand%20Comptroller/验收场景-第一条业务链-2026-10-15.md) | 验收场景的写法和第一批场景 |
| [工程治理与门禁基线](Grand%20Comptroller/工程治理与门禁基线-2026-10-13.md) | 工程约束、门禁和已批准例外 |
| [技术栈与工程架构](Grand%20Comptroller/技术栈与工程架构-2026-10-13.md) | 技术选型 |
| [apps/api/README.md](apps/api/README.md) | 后端接口的实际响应契约 |

## 目录

| 路径 | 内容 |
| --- | --- |
| `apps/web` | Vue 前端（最小页面） |
| `apps/api` | Hono 后端（健康接口与统一错误响应） |
| `packages/contracts` | 前后端共享契约（Zod） |
| `tests/` | 单元测试、浏览器测试及测试辅助 |
| `scripts/` | 检查、门禁与验证脚本 |
| `config/` | 测试、门禁与工具配置 |
| `Grand Comptroller/` | 需求、设计、原型与治理文档 |
| `evidence/` | 本地验证证据，不进入 Git；仅 `evidence/bootstrap/opening-sha256.json` 入库 |
| `.tools/` | 项目内工具链（Node、pnpm、浏览器、CI 工具），不进入 Git |

## 工具链

Node 与 pnpm 版本锁定在 `.prototools`，安装在项目内的 `.tools/proto-home`，不使用也不修改全局版本。所有命令都通过 `scripts/toolchain.mjs` 运行：它检查锁定版本后再执行命令。启动它的 Node 可以是任意版本。

```bash
node scripts/toolchain.mjs pnpm verify
```

直接运行 `pnpm …` 会使用当前 shell 的 Node。如果版本不是 24，会报 `ERR_PNPM_UNSUPPORTED_ENGINE`。

### 首次安装

以下步骤与 CI（`.github/workflows/bootstrap.yml`）一致。需要先安装 [proto](https://moonrepo.dev/proto) 0.63.1。

```bash
PROTO_HOME="$PWD/.tools/proto-home" proto install
node scripts/toolchain.mjs node scripts/ci/install-tools.mjs
node scripts/toolchain.mjs pnpm install --frozen-lockfile --store-dir .tools/pnpm-store
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright" node scripts/toolchain.mjs pnpm exec playwright install chromium
```

`install-tools.mjs` 按 `config/ci/tools.json` 中的版本和 SHA256 下载 rtk、actionlint 到 `.tools/ci-tools/bin`；`scripts/toolchain.mjs` 会把这个目录加入 PATH。

## 常用命令

均以 `node scripts/toolchain.mjs pnpm <命令>` 运行。

| 命令 | 作用 |
| --- | --- |
| `check:static` | 类型、lint、格式、依赖边界、源码规则、锁文件 |
| `test:unit` | 单元测试 |
| `build` | 构建前端和后端 |
| `test:integration` | 在临时 MySQL 容器中做数据库隔离探针 |
| `test:e2e` | 浏览器测试（桌面与手机尺寸） |
| `test:negative` | 门禁负向样例：确认违规能被拦截 |
| `verify` | 按顺序运行以上全部及迁移检查，再由门禁核对结果 |

`verify` 的结果在 `evidence/bootstrap/verify/results.json`，各项日志在同一目录。

### 数据库集成测试

`test:integration`（`verify` 中也会运行）使用 Apple `container` 服务。服务未运行时先启动：

```bash
container system start
```

探针只创建自己的临时容器 `gc-bootstrap-<随机编号>`，用完即删除，并核对已有容器在测试前后没有变化。它不连接也不修改其他容器、数据卷或 QMS 数据。

## 协作流程

- 新功能先用业务语言写验收场景，用户确认后再开工；交付物是可操作页面和逐条对照说明。详见 AGENTS.md。
- 在任务分支上提交并创建 PR，不直接推送 `main`。合并由项目负责人决定。
- 创建 PR 时 Codex 自动审核。之后推送的新提交不会自动重审，需要在 PR 中评论 `@codex review`。审核意见处理完后才算完成。
