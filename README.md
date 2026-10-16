# Grand Comptroller

履约管理系统。当前处于 CORE 阶段，B01 已提供本系统新建和查看设备工单，生产负责人由生产部后续指定；登录与账户管理采用 GC 本地独立账号方案（`LocalAccount` / `LocalSession`），不依赖 QMS 身份桥。用户已于 2026-10-16 明确确认独立账号登录与工单新建查看的业务验收完成。操作见 [B01 交付说明](Grand%20Comptroller/B01-工单关联交付与验收-2026-10-15.md) 与 [独立账号登录交付记录](Grand%20Comptroller/独立账号登录交付记录-2026-10-16.md)，运行配置、账户管理契约及验证边界见 [API 说明](apps/api/README.md)。

## 先读这些

| 文档                                                                            | 用途                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------ |
| [AGENTS.md](AGENTS.md)                                                          | 工作方式：业务验收优先、Git 与 PR 规则、禁止事项 |
| [需求基线](Grand%20Comptroller/需求基线-2026-10-13.md)                          | 业务需求范围                                     |
| [第一条业务链验收场景](Grand%20Comptroller/验收场景-第一条业务链-2026-10-15.md) | 验收场景的写法和第一批场景                       |
| [工程治理与门禁基线](Grand%20Comptroller/工程治理与门禁基线-2026-10-13.md)      | 工程约束、门禁和已批准例外                       |
| [技术栈与工程架构](Grand%20Comptroller/技术栈与工程架构-2026-10-13.md)          | 技术选型                                         |
| [apps/api/README.md](apps/api/README.md)                                        | 后端接口的实际响应契约                           |

## 目录

| 路径                 | 内容                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `apps/web`           | Vue 前端（最小页面）                                                       |
| `apps/api`           | Hono 后端（健康接口与统一错误响应）                                        |
| `packages/contracts` | 前后端共享契约（Zod）                                                      |
| `tests/`             | 单元测试、浏览器测试及测试辅助                                             |
| `scripts/`           | 检查、门禁与验证脚本                                                       |
| `config/`            | 测试、门禁与工具配置                                                       |
| `Grand Comptroller/` | 需求、设计、原型与治理文档                                                 |
| `evidence/`          | 本地验证证据，不进入 Git；仅 `evidence/bootstrap/opening-sha256.json` 入库 |
| `.tools/`            | 项目内工具链（Node、pnpm、浏览器、CI 工具），不进入 Git                    |

## 工具链

Node 与 pnpm 版本锁定在 `.prototools`，安装在项目内的 `.tools/proto-home`，不使用也不修改全局版本。所有命令都通过 `scripts/toolchain.mjs` 运行：它检查锁定版本后再执行命令。

用项目内锁定的 Node 启动它，这样不依赖系统是否安装 Node 或安装了哪个版本。在工程根目录执行：

```bash
GC_NODE="$PWD/.tools/proto-home/tools/node/$(sed -n 's/^node = "\(.*\)"$/\1/p' .prototools)/bin/node"
```

之后的命令都用 `"$GC_NODE" scripts/toolchain.mjs …`，例如：

```bash
"$GC_NODE" scripts/toolchain.mjs pnpm verify
```

直接运行 `pnpm …` 会使用当前 shell 的 Node。如果版本不是 24，会报 `ERR_PNPM_UNSUPPORTED_ENGINE`。

### 首次安装

以下步骤与 CI（`.github/workflows/bootstrap.yml`）一致。只需先安装 [proto](https://moonrepo.dev/proto) 0.63.1，不需要系统 Node。第一步把锁定的 Node 和 pnpm 装进 `.tools/proto-home`，之后用它启动其余步骤。

```bash
PROTO_HOME="$PWD/.tools/proto-home" proto install
GC_NODE="$PWD/.tools/proto-home/tools/node/$(sed -n 's/^node = "\(.*\)"$/\1/p' .prototools)/bin/node"
"$GC_NODE" scripts/toolchain.mjs node scripts/ci/install-tools.mjs
"$GC_NODE" scripts/toolchain.mjs pnpm install --frozen-lockfile --store-dir .tools/pnpm-store
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright" "$GC_NODE" scripts/toolchain.mjs pnpm exec playwright install chromium
```

`install-tools.mjs` 按 `config/ci/tools.json` 中的版本和 SHA256 下载 rtk、actionlint 到 `.tools/ci-tools/bin`；`scripts/toolchain.mjs` 会把这个目录加入 PATH。

## 常用命令

均以 `"$GC_NODE" scripts/toolchain.mjs pnpm <命令>` 运行。

| 命令               | 作用                                           |
| ------------------ | ---------------------------------------------- |
| `check:static`     | 类型、lint、格式、依赖边界、源码规则、锁文件   |
| `test:unit`        | 单元测试                                       |
| `build`            | 构建前端和后端                                 |
| `test:integration` | 在临时 MySQL 容器中做数据库隔离探针            |
| `test:e2e`         | 浏览器测试（桌面与手机尺寸）                   |
| `test:negative`    | 门禁负向样例：确认违规能被拦截                 |
| `verify`           | 按顺序运行以上全部及迁移检查，再由门禁核对结果 |

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
