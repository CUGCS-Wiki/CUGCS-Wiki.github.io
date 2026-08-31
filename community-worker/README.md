# CUGCS Wiki 社区后端

该 Worker 为 CUGCS Wiki 提供站内问答、共建提案和页面评论接口。GitHub OAuth 只用于确认公开身份；社区正文、回答、状态和审核记录存入 Cloudflare D1。

敏感配置只能通过 Cloudflare Secret 写入，禁止提交到仓库：

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET
```

普通变量 `GITHUB_CLIENT_ID`、`GITHUB_CALLBACK_URL` 和 `ADMIN_GITHUB_IDS` 放在 `wrangler.jsonc` 中。完成 OAuth 应用配置前，登录接口会返回“尚未配置”，其余公开读取接口仍可工作。
