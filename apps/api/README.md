# 初始化 API 的实际响应契约

本说明对应当前 checkout `/Users/zhaoxiaojie/代码/Grand-Comptroller`，采用方案 A。锁定 Hono 4.13.7（为清除 4.11.7 的生产依赖安全公告而升级）；不建立自有 HTTP 头清洗或代理协议层。旧资料中的带尾随空格目录是历史路径。

| 入口或异常                           | 状态与响应                                                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                        | 200 JSON：`status: "ok"`、`phase: "BOOTSTRAP"`、`businessReady: false`；不包装为业务成功结果                                                                                      |
| `GET /openapi.json`                  | 发布当前健康接口的 OpenAPI；不虚构业务路由                                                                                                                                        |
| 未匹配路由，包括 `POST /health`      | 404，统一错误 JSON，`code: "NOT_FOUND"`                                                                                                                                           |
| `BusinessException`                  | 保留统一错误 JSON：`success: false`、`code`、公开 `message`、可选 `details`、ISO `timestamp`；默认映射 VALIDATION_FAILED→400、FORBIDDEN→403、NOT_FOUND→404                        |
| 无自定义 Response 的 `HTTPException` | 保留统一错误 JSON；使用异常 status，400/403/404 使用上述代码，其余 4xx 使用 `HTTP_<status>`；空消息使用明确的状态说明；5xx 使用 INTERNAL_SERVER_ERROR 和固定脱敏消息              |
| 带自定义 Response 的 `HTTPException` | 调用 `err.getResponse()`，再用 Hono 原生 `context.newResponse(response.body, response)` 接入上下文头；body 和响应头保留，status 以异常 status 为准，即使与原 Response status 不同 |
| 普通未捕获异常                       | 500，INTERNAL_SERVER_ERROR 与固定脱敏消息；响应不含异常 message、name、stack 或 cause，日志仅记录固定错误分类                                                                     |

自定义 Response 是调用方明确提供的公开输出，可为文本、HTML、二进制或 JSON，包含明确提供的 5xx 响应。不能假设所有 HTTP 错误都符合 `failureResponseSchema`，也不能将内部异常或凭据放入显式公开 Response。统一 JSON 的脱敏仍适用于未知异常及未提供 Response 的 5xx HTTPException。

不再删除 Allow、Proxy-Authenticate、Content-Disposition、ETag、Digest、CSP 或 Content-Range，也不按状态猜测某个头是否应该保留。有效的 body/headers 组合由创建该 Response 的调用方负责；本入口不实现传输层协议清洗。

## 上下文与中间件的实测边界

`getResponse()` 本身不感知 Context。已在锁定版本上验证：通过 `c.header()` 预设的普通头和多个 Cookie，以及显式 Response 的多个 Cookie，均由原生工厂接入；`await next()` 后的中间件仍执行，后置 Cookie 可追加。测试实际使用 Hono `secureHeaders`（配置 `defaultSrc: 'none'` 的 CSP），验证 CSP 和 nosniff 最终由后置安全中间件覆盖。

Hono 4.13.7 有具体限制（与 4.11.7 相同）：若中间件提前读取 `c.res`，响应已在上下文中建立；框架的 `Context.res` 赋值会覆盖同名上下文头，并以旧上下文 Cookie 替换新响应 Cookie。测试和独立原生探针均记录了这个行为。当前生产入口没有提前读取 `c.res` 的中间件，也未全局安装 `secureHeaders`；测试中的中间件结果不代表生产已配置安全策略。今后接入这类中间件须依据实际顺序另行验证，不能宣称所有组合都保留全部 Cookie。

## 保留与删除

删除 `extractExceptionHeaders`、表示头排除集合、`content-` 前缀判定及其复制分支。保留健康端点、现有统一 JSON DTO、业务错误声明与状态映射、Zod 声明式验证及业务错误非法 details 的安全回退。当前契约层没有自造对象原型扫描器；JSON 校验通过既有 Zod schema 实现。没有据此扩大到需求、原型、CI 或治理门禁的清理。

## 依据

- [Hono HTTPException 官方文档](https://hono.dev/docs/api/exception)
- [Hono Context 官方文档](https://hono.dev/docs/api/context)
- [Hono 中间件生命周期官方文档](https://hono.dev/docs/guides/middleware)
- 锁定源码：`node_modules/.pnpm/hono@4.13.7/node_modules/hono/dist/http-exception.js`、`context.js`、`compose.js`、`hono-base.js`、`middleware/secure-headers/secure-headers.js`
- 升级复核：4.11.7 与 4.13.7 的上述源文件逐一比对。`http-exception.js` 与 `compose.js` 相同；`context.js` 仅将 `new Response` 收敛为内部工厂，并重写 `newResponse` 的头合并实现，`set res` 的同名头覆盖与 Cookie 替换逻辑不变，传入 Response 时的头合并结果不变；`hono-base.js` 改动为路由方法名与子应用 basePath；`secure-headers.js` 改动为 CSP nonce 回调只写入对应头，以及 Permissions-Policy 的 `none` 输出为 `()`，不影响本文所述的后置覆盖顺序。上述测试在 4.13.7 上未改断言全部通过
- 本地验证与源快照证据由本次清理交付记录单独保存；本说明不代表 CI、远端强制、真实业务验收或独立审查完成。
