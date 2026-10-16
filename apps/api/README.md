# GC 后端：本地账户与会话契约

GC 的登录、账户有效性和授权全部由 GC 自己的 MySQL 数据库处理。QMS 不参与运行时；当前生产组合不读取 QMS URL、密钥、登录地址或用户权限映射。旧 `apps/api/src/identity/` 和 `IdentitySession` 是历史交付证据，当前不挂载其路由，也不调用它们。

当前运行入口 `apps/api/src/runtime.ts` 已接入 `LocalAccounts` 与 `localAuthRoutes`，前端已实现登录页 `LoginPage.vue`、账户管理页 `AccountsPage.vue` 与工单页 `WorkOrdersPage.vue`，并通过浏览器端对端验收。

## 配置、迁移和首个管理员

生产只需要：

| 配置               | 要求                                                                           |
| ------------------ | ------------------------------------------------------------------------------ |
| `GC_DATABASE_URL`  | GC 独立 MySQL 数据库连接。迁移账户须有 DDL 权限；运行账户仅有应用读写权限。    |
| `GC_PUBLIC_ORIGIN` | 完整 HTTPS origin，例如 `https://gc.company.example`，没有路径、凭据或尾斜杠。 |
| `HOST` / `PORT`    | 可选，默认 `127.0.0.1` / `3000`。                                              |

```bash
GC_NODE="$PWD/.tools/proto-home/tools/node/24.21.0/bin/node"
"$GC_NODE" scripts/toolchain.mjs pnpm db:deploy
"$GC_NODE" scripts/toolchain.mjs pnpm bootstrap:admin
"$GC_NODE" scripts/toolchain.mjs pnpm start:api
```

`bootstrap:admin` 仅在没有启用的账户管理员时运行。它从 TTY 交互读取用户名、显示名和不回显的密码；密码不接受命令行参数，也不会输出。没有默认账户、启动自动开户、HTTP 初始化、自助注册、邮件或短信找回。

用户名只能为 3–64 个 `[A-Za-z0-9._-]`，按 Unicode NFKC 后转小写，并由数据库唯一约束。显示名为 1–128 字符。密码是 12–128 字符，逐字节处理，不 trim 或规范化。

## 会话和授权策略

密码使用异步 Node `scrypt`（随机 16-byte salt，N=16384、r=8、p=1、64-byte output）散列。浏览器 token 是随机 32-byte base64url 值，数据库只保存 SHA-256；密码、散列和 token 均不返回。会话有效期为 1 小时。

每次成功登录在可串行化事务中提高 `authVersion`、撤销该账户旧会话并建立新会话。每次请求重新读取会话、账户 `active`、权限和版本；密码重置、停用或权限变更均提高版本并删除会话。因此这些操作后的下一次请求被拒绝。已开始的其他业务事务不能被追溯取消。

| 能力                 | 效果                                |
| -------------------- | ----------------------------------- |
| `work-orders:read`   | 读取工单和人员显示来源。            |
| `work-orders:create` | 新建工单；保存时自动同时具有 read。 |
| `accountAdmin: true` | 管理账户 API；与工单权限独立。      |

最后一个启用的账户管理员不可停用或取消管理员能力。检查和写入在可串行化事务完成，并对死锁/序列化冲突最多重试三次。目标账户被重置、停用或更改权限时，其会话被撤销。

登录失败对不存在、停用、密码错误和损坏散列均返回 `INVALID_CREDENTIALS`。进程内按标准化用户名最多记录 1024 个失败项目，每个 60 秒窗口最多 5 次；这是透明的单进程节流，不是跨实例或永久业务锁定。

生产 cookie 固定为 `__Host-gc-session`，带 `HttpOnly; Secure; SameSite=Lax; Path=/` 且无 `Domain`。仅运行时显式测试注入 `insecureCookiesForTesting: true` 能发 HTTP cookie；服务器环境变量不能开启它。

## HTTP 契约

所有响应为 `Cache-Control: no-store`。成功体为 `{ success: true, data, timestamp }`，失败体为 `{ success: false, code, message, timestamp }`。所有 `POST` 和 `PUT`（包括登录和退出）必须带与 `GC_PUBLIC_ORIGIN` 完全一致的 `Origin`；body 严格 JSON，不接受额外字段。

| 接口                                     | 请求 DTO                                                  | 成功响应                                                             | 失败                                                 |
| ---------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------- |
| `POST /api/auth/login`                   | `{ username, password }`                                  | `200 { principal }`，设置 session cookie                             | `400`、`403 INVALID_CREDENTIALS`、`503`              |
| `POST /api/auth/logout`                  | 严格 `{}`，不接受额外字段或无效 JSON                      | `200 { loggedOut: true }`；先删服务端会话再清 cookie                 | `400`、`403`、`503`（cookie 保留可重试）             |
| `GET /api/session`                       | 无                                                        | `200 { mode: "production", principal, loginUrl: "/api/auth/login" }` | `503`                                                |
| `GET /api/accounts`                      | 管理员 session                                            | `200 Account[]`                                                      | `403`                                                |
| `POST /api/accounts`                     | `{ username, name, password, permissions, accountAdmin }` | `201 Account`                                                        | `400`、`403`、`409 ACCOUNT_USERNAME_EXISTS`、`503`   |
| `PUT /api/accounts/{id}/permissions`     | `{ permissions, accountAdmin }`                           | `200 Account`                                                        | `400`、`403`、`404`、`409 ACCOUNT_LAST_ADMIN`、`503` |
| `POST /api/accounts/{id}/reset-password` | `{ password }`                                            | `200 Account`                                                        | `400`、`403`、`404`、`503`                           |
| `PUT /api/accounts/{id}/active`          | `{ active }`                                              | `200 Account`                                                        | `400`、`403`、`404`、`409 ACCOUNT_LAST_ADMIN`、`503` |
| `GET`/`POST /api/work-orders`            | 需要 read/create session                                  | 既有 B01 DTO                                                         | `403`、既有业务失败码                                |

`Principal` 为 `{ id, name, permissions, accountAdmin }`。`Account` 为 `{ id, username, name, permissions, accountAdmin, active, createdAt, updatedAt }`，绝不包含散列、token 或 `authVersion`。完整机器可读契约为 `GET /openapi.json`。

## 验证入口和当前边界

```bash
GC_NODE="$PWD/.tools/proto-home/tools/node/24.21.0/bin/node"
"$GC_NODE" scripts/toolchain.mjs pnpm db:generate
"$GC_NODE" scripts/toolchain.mjs pnpm check:types
rtk vitest run tests/unit/local-auth.test.ts tests/unit/runtime.test.ts --config config/vitest.config.ts
"$GC_NODE" scripts/toolchain.mjs pnpm test:local-auth
```

`test:local-auth` 通过 `withBusinessDatabase` 创建并回收任务专用 MySQL 8.4 容器，部署迁移、检查 schema 并用 `rtk vitest run` 串行运行本地认证集成测试。结果保存在本次 `evidence/contained/runs/<run-id>/local-auth-vitest.json` 和 `local-auth-vitest.log`。它覆盖登录、重复用户名、权限及管理员能力的即时变更、真实工单行写入、会话过期/轮换、重置或停用与登录并发、最后管理员的并发取消管理员/停用、退出与会话解析的注入持久化故障；不会使用既有数据库、容器或卷。

主会话已在其隔离环境执行原始四个本地认证集成测试：`test:local-auth` 退出码 0，4/4 通过且清理完成；原始日志为 `/Users/zhaoxiaojie/.claude/jobs/95484c81/tmp/local-auth-main-db.log`，隔离报告为 `evidence/contained/runs/bdbc6a12-7661-48dd-a4b8-3035b0c5ec5c/business-database.json`。本修订新增的集成断言尚待主会话下一次隔离 MySQL 执行；本轮按授权不启动数据库测试。迁移仍须由该下一次运行执行 `migrate deploy` 与 `migrate diff --exit-code`。旧 QMS bridge 测试和脚本仍在仓库中，已不证明当前运行时；任务 02 应在不放宽门禁的前提下退休其运行时声明并完成 UI/E2E。
