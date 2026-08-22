# 1.3 MFA Architecture

状态：Design contract；production Gateway 仍为 password-only。

本文定义真实 MFA 上线前必须满足的领域边界。当前 generic transaction、Control v3、
Desktop challenge 和 synthetic provider 只能证明架构可扩展，不能证明学校 Gateway 的
SMS、TOTP、CAPTCHA、Push、SSO 或证书认证已经可用。

## 1. Goals

- 将认证建模为 Engine-owned 状态机，而不是 UI patch；
- Password 和未来经证据确认的 provider 共用稳定入口与结果；
- challenge secret 不离开最小必要边界；
- cancel、timeout、resend、restart、network generation change 均有确定结果；
- Authentication 只产出 authenticated session，不装配 L3/Data Plane；
- 新增一个 provider 不要求重写 Modern L3、DNS、SOCKS 或 Campus Browser。

## 2. Non-goals

- 猜测学校 endpoint、字段、验证码长度、文案或渠道映射；
- 绕过、截获、伪造第二因素；
- 将 TwfID、Cookie、CSRF、continuation 或 transport token 暴露给 Renderer；
- 将 OTP 写入 settings、credential vault、clipboard、日志、telemetry 或 crash report；
- 因识别到某个状态名称就宣称 provider 可用；
- 将校园网页/SSO MFA 与 VPN Gateway MFA 混为同一个协议。

## 3. Two independent MFA scenarios

### A. VPN Gateway requires MFA

```text
Primary credential
  -> Gateway challenge
  -> user response / resend / cancel
  -> authenticated Gateway session
  -> TransportBackend
  -> L3/Data Plane
```

Gateway partial Cookie、TwfID、CSRF、opaque continuation 和 endpoint state 全部保留在
Rust provider/transaction 内。

### B. VPN remains password-only; campus Web/SSO requires MFA

由 Campus Browser 负责：redirect、popup、cross-origin SSO、SameSite Cookie、SPA、
`autocomplete=one-time-code` 和登录成功判定。它不修改 VPN AuthProvider，也不把网页
OTP 送进 Engine。

两个场景可以同时发生，但状态和 secret 不共享。

## 4. Domain types

```text
AuthRequest
  Password { borrowed username, borrowed password }
  ChallengeResponse { method, zeroizing response }

AuthProgress
  ChallengeRequired(SanitizedChallenge)
  Authenticated(AuthenticatedGatewaySession)

AuthTerminalOutcome
  Rejected
  Indeterminate
  ProtocolInvalid
  Unsupported
  Expired
  LimitExceeded
  Cancelled
  NetworkInterrupted
  CleanupUnconfirmed(primary)
```

`SanitizedChallenge` 只允许展示所需的 method、prompt key、是否可 resend、过期时间和
有界 display hint。它不能包含 provider endpoint、Cookie/token、原始响应、真实手机号/
邮箱全文或内部 transaction identity。

## 5. Authentication state machine

```text
Unauthenticated
  --password submitted--> PrimaryAuth

PrimaryAuth
  --explicit reject--> Rejected
  --uncertain network result--> Indeterminate
  --challenge--> ChallengePending
  --authenticated--> Authenticated

ChallengePending
  --valid response--> Verifying
  --resend allowed--> ChallengePending(new epoch)
  --cancel--> Cancelling
  --deadline/budget--> Expired|LimitExceeded

Verifying
  --new challenge--> ChallengePending(new epoch)
  --authenticated--> Authenticated
  --explicit reject--> ChallengePending|Rejected (provider contract)
  --uncertain result--> Indeterminate

Cancelling
  --cleanup complete--> Cancelled
  --cleanup uncertain--> CleanupUnconfirmed(Cancelled)
```

每个 transition 同时绑定：

- Desktop connection intent；
- Engine generation；
- opaque transaction ID；
- challenge epoch；
- unique request ID；
- monotonic total deadline；
- steps/submits/resends/gateway-request budgets。

stale/duplicate command 不得改变当前事务。Unknown provider transition 必须 fail-closed。

## 6. Ownership and interfaces

### AuthProvider

负责一个具体、已验证认证协议的状态推进。Provider 可以持有 opaque partial state，绝不
持有 Desktop object、Data Plane 或本地 proxy。

### AuthTransactionOwner

Engine 的权威 owner，负责 context binding、预算、deadline、exactly-once cleanup 和
sanitized public view。Provider 没有权绕过预算直接执行 continuation 网络请求。

### AuthCoordinator

在 process composition 层同时等待：

- provider completion；
- private control input；
- shutdown/signal；
- pipe EOF；
- network/Engine generation invalidation；
- total deadline。

Blocking provider 必须位于可取消 worker 后；取消后晚到 authenticated session 必须立即
logout，不能进入 Transport。

### AuthenticatedGatewaySession

认证唯一成功产物，包含认证后的 HTTPS session/cookie jar、opaque identity 和 logout。
Transport 只能消费此类型，不能接受“部分认证”或 challenge state。

### Control API

- v2：secret-free process control；
- v3：显式 secret-bearing challenge respond/resend/cancel；
- 两者可以复用 inherited private pipe，但 schema、frame bound 和解析状态独立；
- stdout 事件不得回显 response 或 Engine-private context；
- Renderer 只看到 sanitized challenge，并通过 Main coordinator 提交一次性 response。

## 7. Secret lifecycle

OTP/response：

1. DOM input 只在用户提交时读取；
2. Renderer 调用后立刻清空字段和引用；
3. Main 转为有界 Buffer，不复制到普通对象；
4. wire Buffer 写入后 zeroize；
5. Rust decoder 使用 zeroizing buffer；
6. provider consume、cancel、timeout 或错误后清理；
7. 不进入持久化、clipboard、日志、telemetry、exception message。

Password vault 不能把 one-time-code 或模糊单 secret 字段当普通网站密码。

## 8. Error and retry policy

- 只有验证过的结构化拒绝是 `AUTH_REJECTED`；
- timeout/reset/partial response 是 `AUTH_INDETERMINATE`；
- schema/bounds 违反是 `AUTH_PROTOCOL_INVALID`；
- unknown method 是 `UNSUPPORTED_AUTHENTICATION`；
- cleanup 是 secondary status，不覆盖 primary；
- 密码和 OTP 不自动盲目重试；
- resend 只能由 provider capability、cooldown 和预算共同允许；
- network generation change 终止整个认证，不迁移 Cookie/continuation。

## 9. Provider activation gate

一个真实方法从 `Unsupported` 升为 production support 前必须：

1. 学校提供受控 profile 和授权测试身份；
2. 使用受支持官方客户端观察同一方法；
3. 记录脱敏、最小、可复现的状态/字段/失败事实；
4. fixture 不包含真实凭据、Cookie、token、手机号或邮箱；
5. 独立实现一个 provider，不修改无关 Transport/frontend；
6. synthetic HTTPS Gateway 覆盖正常、wrong response、resend、expiry、partial、timeout、
   reset、logout failure；
7. 未知状态、字段变化和不支持方法 fail-closed；
8. 同 profile official parity 和 staff canary 通过；
9. 文档从 `I2/E2` 更新为至少 `I3/E4`；
10. 有明确 rollback，可以关闭该 provider 而保留 password-only 路径。

## 10. Test matrix

| 层 | 必测项 |
| --- | --- |
| State unit | 每个 state×event、非法转换、stale/duplicate、budget/deadline |
| Secret contract | Debug/error/event/log/clipboard/settings 均不含 response |
| Provider synthetic | success、reject、new challenge、resend、expiry、unknown、cleanup |
| HTTPS synthetic | TLS、Cookie/CSRF rotation、partial body、timeout/reset、logout |
| Process integration | pipe fragmentation、EOF、signal、renderer crash、Engine replacement |
| Desktop Electron | dialog/window、keyboard/accessibility、same-window/SPA/popup/cross-origin |
| Real canary | 每个实际启用方法独立测试，不用一个方法替另一个方法背书 |

## 11. Incremental route to 1.3

1. 收束 1.x Connection FSM 和 Transport cancellation；
2. 建立 test-only synthetic HTTPS Gateway；
3. 将 generic AuthCoordinator 接入完整 Password→Challenge 总预算；
4. 完成独立最小权限 MFA window 或证明现有 control Renderer 权限可接受；
5. 获得第一种真实学校方法的脱敏证据；
6. 只实现该 provider；
7. parity/canary 后发布 1.3；
8. 后续方法逐个重复 activation gate。
