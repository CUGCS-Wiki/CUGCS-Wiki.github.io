interface Env {
  DB: D1Database;
  WIKI_ORIGIN: string;
  ALLOWED_ORIGINS: string;
  GITHUB_CALLBACK_URL: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_TTL_SECONDS: string;
  OAUTH_STATE_TTL_SECONDS: string;
  ADMIN_GITHUB_IDS: string;
}

interface AppUser {
  id: number;
  github_id: number;
  login: string;
  display_name: string | null;
  avatar_url: string;
  profile_url: string;
  role: "member" | "moderator" | "admin";
}

interface TopicRow {
  id: string;
  kind: TopicKind;
  page_key: string | null;
  category: string | null;
  title: string;
  author_id: number;
  status: string;
  accepted_post_id: string | null;
  reply_count: number;
  created_at: number;
  updated_at: number;
  last_activity_at: number;
  author_login: string;
  author_display_name: string | null;
  author_avatar_url: string;
  author_profile_url: string;
  author_role: AppUser["role"];
  body_excerpt?: string;
}

interface PostRow {
  id: string;
  topic_id: string;
  author_id: number;
  kind: "body" | "answer" | "comment";
  body_markdown: string;
  created_at: number;
  updated_at: number;
  author_login: string;
  author_display_name: string | null;
  author_avatar_url: string;
  author_profile_url: string;
  author_role: AppUser["role"];
}

type TopicKind = "question" | "proposal" | "page";

const TOPIC_CATEGORIES = new Set([
  "courses",
  "competitions",
  "research",
  "postgraduate",
  "campus",
  "other",
]);

const PROPOSAL_STATUSES = new Set([
  "collecting",
  "evidence_needed",
  "accepted",
  "drafting",
  "reviewing",
  "published",
  "paused",
]);

const PROPOSAL_TRANSITIONS: Record<string, Set<string>> = {
  collecting: new Set(["evidence_needed", "accepted", "paused"]),
  evidence_needed: new Set(["collecting", "accepted", "paused"]),
  accepted: new Set(["drafting", "collecting", "paused"]),
  drafting: new Set(["reviewing", "accepted", "paused"]),
  reviewing: new Set(["drafting", "published", "paused"]),
  published: new Set(["reviewing"]),
  paused: new Set(["collecting", "evidence_needed", "accepted", "drafting"]),
};

const MAX_BODY_BYTES = 65_536;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonResponse(
          request,
          env,
          { ok: false, error: { code: error.code, message: error.message } },
          error.status,
        );
      }

      console.error("Unhandled community API error", error);
      return jsonResponse(
        request,
        env,
        {
          ok: false,
          error: { code: "internal_error", message: "服务器暂时无法处理该请求。" },
        },
        500,
      );
    }
  },
};

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (request.method === "OPTIONS") {
    return preflightResponse(request, env);
  }

  if (request.method === "GET" && path === "/") {
    return jsonResponse(request, env, {
      ok: true,
      data: { service: "CUGCS Wiki Community API", status: "ok" },
    });
  }

  if (request.method === "GET" && path === "/api/v1/health") {
    await env.DB.prepare("SELECT 1").first();
    return jsonResponse(request, env, {
      ok: true,
      data: { status: "ok", timestamp: now() },
    });
  }

  if (request.method === "GET" && path === "/api/v1/auth/github/start") {
    return startGithubLogin(request, env);
  }

  if (request.method === "GET" && path === "/api/v1/auth/github/callback") {
    return finishGithubLogin(request, env);
  }

  if (request.method === "POST" && path === "/api/v1/auth/exchange") {
    return exchangeLoginTicket(request, env);
  }

  if (request.method === "GET" && path === "/api/v1/me") {
    const user = await getSessionUser(request, env);
    return jsonResponse(request, env, { ok: true, data: { user } });
  }

  if (request.method === "POST" && path === "/api/v1/auth/logout") {
    return logout(request, env);
  }

  if (request.method === "GET" && path === "/api/v1/topics") {
    return listTopics(request, env);
  }

  if (request.method === "POST" && path === "/api/v1/topics") {
    return createTopic(request, env);
  }

  const topicMatch = path.match(/^\/api\/v1\/topics\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && topicMatch) {
    return getTopic(request, env, topicMatch[1]);
  }

  const topicPostsMatch = path.match(/^\/api\/v1\/topics\/([0-9a-f-]+)\/posts$/i);
  if (request.method === "POST" && topicPostsMatch) {
    return createPost(request, env, topicPostsMatch[1]);
  }

  const acceptMatch = path.match(/^\/api\/v1\/topics\/([0-9a-f-]+)\/accept$/i);
  if (request.method === "POST" && acceptMatch) {
    return acceptAnswer(request, env, acceptMatch[1]);
  }

  const transitionMatch = path.match(
    /^\/api\/v1\/topics\/([0-9a-f-]+)\/transition$/i,
  );
  if (request.method === "POST" && transitionMatch) {
    return transitionProposal(request, env, transitionMatch[1]);
  }

  const postMatch = path.match(/^\/api\/v1\/posts\/([0-9a-f-]+)$/i);
  if (request.method === "PATCH" && postMatch) {
    return editPost(request, env, postMatch[1]);
  }
  if (request.method === "DELETE" && postMatch) {
    return deletePost(request, env, postMatch[1]);
  }

  const reportMatch = path.match(/^\/api\/v1\/posts\/([0-9a-f-]+)\/report$/i);
  if (request.method === "POST" && reportMatch) {
    return reportPost(request, env, reportMatch[1]);
  }

  if (request.method === "GET" && path === "/api/v1/page-thread") {
    return getPageThread(request, env);
  }

  if (request.method === "POST" && path === "/api/v1/page-thread/posts") {
    return createPageComment(request, env);
  }

  throw new ApiError(404, "not_found", "没有找到这个接口。 ");
}

async function startGithubLogin(request: Request, env: Env): Promise<Response> {
  requireGithubConfig(env, false);
  await rateLimit(request, env, "oauth_start", 20, 3600);

  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to"), env);
  const state = randomToken(32);
  const verifier = randomToken(48);
  const stateHash = await sha256(state);
  const challenge = await sha256Base64Url(verifier);
  const timestamp = now();
  const ttl = positiveInteger(env.OAUTH_STATE_TTL_SECONDS, 600);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(timestamp),
    env.DB.prepare(
      "INSERT INTO oauth_states (state_hash, code_verifier, return_to, expires_at) VALUES (?, ?, ?, ?)",
    ).bind(stateHash, verifier, returnTo, timestamp + ttl),
  ]);

  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID!);
  authorize.searchParams.set("redirect_uri", env.GITHUB_CALLBACK_URL);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  return Response.redirect(authorize.toString(), 302);
}

async function finishGithubLogin(request: Request, env: Env): Promise<Response> {
  requireGithubConfig(env, true);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    throw new ApiError(400, "oauth_denied", "GitHub 登录已取消或未获授权。 ");
  }
  if (!code || !state) {
    throw new ApiError(400, "oauth_invalid_callback", "GitHub 登录回调缺少必要参数。 ");
  }

  const stateHash = await sha256(state);
  const stored = await env.DB.prepare(
    "DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING code_verifier, return_to",
  )
    .bind(stateHash, now())
    .first<{ code_verifier: string; return_to: string }>();

  if (!stored) {
    throw new ApiError(400, "oauth_state_expired", "登录请求已失效，请返回网站重新登录。 ");
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "CUGCS-Wiki-Community",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: env.GITHUB_CALLBACK_URL,
      code_verifier: stored.code_verifier,
    }),
  });

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenResponse.ok || !tokenData.access_token) {
    console.error("GitHub token exchange failed", tokenData.error || tokenResponse.status);
    throw new ApiError(502, "oauth_exchange_failed", "GitHub 暂时未能完成身份确认。 ");
  }

  const githubResponse = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokenData.access_token}`,
      "User-Agent": "CUGCS-Wiki-Community",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const githubUser = (await githubResponse.json()) as {
    id?: number;
    login?: string;
    name?: string | null;
    avatar_url?: string;
  };

  if (!githubResponse.ok || !githubUser.id || !githubUser.login) {
    throw new ApiError(502, "github_identity_failed", "无法读取 GitHub 公开身份。 ");
  }

  const timestamp = now();
  const role = adminGithubIds(env).has(githubUser.id) ? "admin" : "member";
  const avatarUrl = safeGithubAvatar(githubUser.avatar_url);
  const profileUrl = `https://github.com/${encodeURIComponent(githubUser.login)}`;

  await env.DB.prepare(
    `INSERT INTO users
      (github_id, login, display_name, avatar_url, profile_url, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(github_id) DO UPDATE SET
       login = excluded.login,
       display_name = excluded.display_name,
       avatar_url = excluded.avatar_url,
       profile_url = excluded.profile_url,
       role = CASE WHEN excluded.role = 'admin' THEN 'admin' ELSE users.role END,
       updated_at = excluded.updated_at`,
  )
    .bind(
      githubUser.id,
      githubUser.login,
      normalizeOptionalText(githubUser.name, 80),
      avatarUrl,
      profileUrl,
      role,
      timestamp,
      timestamp,
    )
    .run();

  const user = await env.DB.prepare("SELECT id FROM users WHERE github_id = ?")
    .bind(githubUser.id)
    .first<{ id: number }>();
  if (!user) {
    throw new ApiError(500, "user_create_failed", "无法建立站内身份。 ");
  }

  const ticket = randomToken(32);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_tickets WHERE expires_at <= ?").bind(timestamp),
    env.DB.prepare(
      "INSERT INTO login_tickets (ticket_hash, user_id, expires_at) VALUES (?, ?, ?)",
    ).bind(await sha256(ticket), user.id, timestamp + 120),
  ]);

  const destination = new URL(stored.return_to);
  destination.hash = new URLSearchParams({ cugcs_auth_code: ticket }).toString();
  return Response.redirect(destination.toString(), 302);
}

async function exchangeLoginTicket(request: Request, env: Env): Promise<Response> {
  await rateLimit(request, env, "oauth_exchange", 30, 3600);
  const body = await readJson<{ code?: unknown }>(request);
  const code = requiredText(body.code, "登录凭证", 20, 200);
  const timestamp = now();
  const consumed = await env.DB.prepare(
    "DELETE FROM login_tickets WHERE ticket_hash = ? AND expires_at > ? RETURNING user_id",
  )
    .bind(await sha256(code), timestamp)
    .first<{ user_id: number }>();

  if (!consumed) {
    throw new ApiError(400, "login_ticket_invalid", "登录凭证已失效，请重新登录。 ");
  }

  const token = randomToken(32);
  const expiresAt = timestamp + positiveInteger(env.SESSION_TTL_SECONDS, 28_800);
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(await sha256(token), consumed.user_id, timestamp, expiresAt)
    .run();

  return jsonResponse(request, env, {
    ok: true,
    data: { token, expires_at: expiresAt },
  });
}

async function logout(request: Request, env: Env): Promise<Response> {
  const token = bearerToken(request);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256(token))
      .run();
  }
  return jsonResponse(request, env, { ok: true, data: { logged_out: true } });
}

async function listTopics(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as TopicKind | null;
  if (kind !== "question" && kind !== "proposal") {
    throw new ApiError(400, "invalid_kind", "列表类型必须是问题或共建提案。 ");
  }

  const limit = Math.min(
    positiveInteger(url.searchParams.get("limit") || "", DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const offset = Math.max(0, integer(url.searchParams.get("offset"), 0));
  const category = normalizeOptionalText(url.searchParams.get("category"), 40);
  const status = normalizeOptionalText(url.searchParams.get("status"), 40);
  const q = normalizeOptionalText(url.searchParams.get("q"), 80);

  if (category && !TOPIC_CATEGORIES.has(category)) {
    throw new ApiError(400, "invalid_category", "未知的主题分类。 ");
  }
  if (status && !validStatusForKind(kind, status)) {
    throw new ApiError(400, "invalid_status", "未知的主题状态。 ");
  }

  const conditions = ["t.deleted_at IS NULL", "t.kind = ?"];
  const binds: unknown[] = [kind];
  if (category) {
    conditions.push("t.category = ?");
    binds.push(category);
  }
  if (status) {
    conditions.push("t.status = ?");
    binds.push(status);
  }
  if (q) {
    conditions.push(
      "(LOWER(t.title) LIKE LOWER(?) OR EXISTS (SELECT 1 FROM posts sp WHERE sp.topic_id = t.id AND sp.kind = 'body' AND sp.deleted_at IS NULL AND LOWER(sp.body_markdown) LIKE LOWER(?)))",
    );
    binds.push(`%${q}%`, `%${q}%`);
  }

  const where = conditions.join(" AND ");
  const rows = await env.DB.prepare(
    `SELECT t.*, u.login AS author_login, u.display_name AS author_display_name,
       u.avatar_url AS author_avatar_url, u.profile_url AS author_profile_url,
       u.role AS author_role,
       COALESCE((SELECT SUBSTR(p.body_markdown, 1, 260) FROM posts p
         WHERE p.topic_id = t.id AND p.kind = 'body' AND p.deleted_at IS NULL LIMIT 1), '') AS body_excerpt
     FROM topics t JOIN users u ON u.id = t.author_id
     WHERE ${where}
     ORDER BY t.last_activity_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<TopicRow>();

  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM topics t WHERE ${where}`,
  )
    .bind(...binds)
    .first<{ total: number }>();

  return jsonResponse(request, env, {
    ok: true,
    data: {
      topics: rows.results.map(topicJson),
      total: count?.total ?? 0,
      limit,
      offset,
    },
  });
}

async function createTopic(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  await rateLimit(request, env, `topic:${user.id}`, 5, 600);
  const body = await readJson<{
    kind?: unknown;
    category?: unknown;
    title?: unknown;
    body?: unknown;
  }>(request);
  const kind = requiredText(body.kind, "类型", 1, 20) as TopicKind;
  if (kind !== "question" && kind !== "proposal") {
    throw new ApiError(400, "invalid_kind", "只能创建问题或共建提案。 ");
  }
  const category = requiredText(body.category, "分类", 1, 40);
  if (!TOPIC_CATEGORIES.has(category)) {
    throw new ApiError(400, "invalid_category", "请选择有效的主题分类。 ");
  }
  const title = requiredText(body.title, "标题", 8, 120);
  const bodyMarkdown = requiredText(body.body, "正文", 20, 12_000);
  const id = crypto.randomUUID();
  const postId = crypto.randomUUID();
  const timestamp = now();
  const status = kind === "question" ? "open" : "collecting";

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO topics
        (id, kind, category, title, author_id, status, created_at, updated_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, kind, category, title, user.id, status, timestamp, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO posts
        (id, topic_id, author_id, kind, body_markdown, created_at, updated_at)
       VALUES (?, ?, ?, 'body', ?, ?, ?)`,
    ).bind(postId, id, user.id, bodyMarkdown, timestamp, timestamp),
  ]);

  return jsonResponse(request, env, { ok: true, data: { id } }, 201);
}

async function getTopic(request: Request, env: Env, id: string): Promise<Response> {
  const detail = await loadTopicDetail(env, id);
  if (!detail) {
    throw new ApiError(404, "topic_not_found", "该主题不存在或已经被移除。 ");
  }
  return jsonResponse(request, env, { ok: true, data: detail });
}

async function createPost(
  request: Request,
  env: Env,
  topicId: string,
): Promise<Response> {
  const user = await requireUser(request, env);
  await rateLimit(request, env, `post:${user.id}`, 20, 600);
  const topic = await env.DB.prepare(
    "SELECT id, kind, status FROM topics WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(topicId)
    .first<{ id: string; kind: TopicKind; status: string }>();
  if (!topic) {
    throw new ApiError(404, "topic_not_found", "该主题不存在或已经被移除。 ");
  }
  if (topic.status === "closed") {
    throw new ApiError(409, "topic_closed", "该主题已经关闭，暂时不能继续回复。 ");
  }
  const input = await readJson<{ body?: unknown }>(request);
  const bodyMarkdown = requiredText(input.body, "回复", 2, 12_000);
  const id = crypto.randomUUID();
  const timestamp = now();
  const postKind = topic.kind === "question" ? "answer" : "comment";

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO posts
        (id, topic_id, author_id, kind, body_markdown, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, topicId, user.id, postKind, bodyMarkdown, timestamp, timestamp),
    env.DB.prepare(
      `UPDATE topics SET reply_count = reply_count + 1,
       updated_at = ?, last_activity_at = ? WHERE id = ?`,
    ).bind(timestamp, timestamp, topicId),
  ]);

  return jsonResponse(request, env, { ok: true, data: { id } }, 201);
}

async function acceptAnswer(
  request: Request,
  env: Env,
  topicId: string,
): Promise<Response> {
  const user = await requireUser(request, env);
  const input = await readJson<{ post_id?: unknown }>(request);
  const postId = requiredText(input.post_id, "回答编号", 10, 80);
  const topic = await env.DB.prepare(
    "SELECT id, kind, author_id FROM topics WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(topicId)
    .first<{ id: string; kind: TopicKind; author_id: number }>();
  if (!topic || topic.kind !== "question") {
    throw new ApiError(404, "question_not_found", "没有找到这个问题。 ");
  }
  if (topic.author_id !== user.id && !isStaff(user)) {
    throw new ApiError(403, "forbidden", "只有提问者或社区维护者可以采纳回答。 ");
  }
  const post = await env.DB.prepare(
    "SELECT id FROM posts WHERE id = ? AND topic_id = ? AND kind = 'answer' AND deleted_at IS NULL",
  )
    .bind(postId, topicId)
    .first<{ id: string }>();
  if (!post) {
    throw new ApiError(400, "invalid_answer", "要采纳的回答不存在。 ");
  }
  const timestamp = now();
  await env.DB.prepare(
    "UPDATE topics SET accepted_post_id = ?, status = 'answered', updated_at = ?, last_activity_at = ? WHERE id = ?",
  )
    .bind(postId, timestamp, timestamp, topicId)
    .run();
  return jsonResponse(request, env, { ok: true, data: { accepted_post_id: postId } });
}

async function transitionProposal(
  request: Request,
  env: Env,
  topicId: string,
): Promise<Response> {
  const user = await requireUser(request, env);
  const input = await readJson<{ status?: unknown }>(request);
  const nextStatus = requiredText(input.status, "目标状态", 2, 40);
  if (!PROPOSAL_STATUSES.has(nextStatus)) {
    throw new ApiError(400, "invalid_status", "未知的共建状态。 ");
  }
  const topic = await env.DB.prepare(
    "SELECT id, kind, author_id, status FROM topics WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(topicId)
    .first<{ id: string; kind: TopicKind; author_id: number; status: string }>();
  if (!topic || topic.kind !== "proposal") {
    throw new ApiError(404, "proposal_not_found", "没有找到这个共建提案。 ");
  }
  if (topic.author_id !== user.id && !isStaff(user)) {
    throw new ApiError(403, "forbidden", "只有发起人或社区维护者可以更新状态。 ");
  }
  if (!PROPOSAL_TRANSITIONS[topic.status]?.has(nextStatus)) {
    throw new ApiError(409, "invalid_transition", "当前状态不能直接变更为目标状态。 ");
  }
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE topics SET status = ?, updated_at = ?, last_activity_at = ? WHERE id = ?",
    ).bind(nextStatus, timestamp, timestamp, topicId),
    env.DB.prepare(
      `INSERT INTO moderation_events
        (id, actor_id, action, target_type, target_id, detail, created_at)
       VALUES (?, ?, 'proposal_transition', 'topic', ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      user.id,
      topicId,
      JSON.stringify({ from: topic.status, to: nextStatus }),
      timestamp,
    ),
  ]);
  return jsonResponse(request, env, { ok: true, data: { status: nextStatus } });
}

async function editPost(request: Request, env: Env, postId: string): Promise<Response> {
  const user = await requireUser(request, env);
  await rateLimit(request, env, `edit:${user.id}`, 30, 600);
  const post = await env.DB.prepare(
    "SELECT id, topic_id, author_id FROM posts WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(postId)
    .first<{ id: string; topic_id: string; author_id: number }>();
  if (!post) {
    throw new ApiError(404, "post_not_found", "没有找到这条内容。 ");
  }
  if (post.author_id !== user.id && !isStaff(user)) {
    throw new ApiError(403, "forbidden", "只能编辑自己的内容。 ");
  }
  const input = await readJson<{ body?: unknown }>(request);
  const bodyMarkdown = requiredText(input.body, "正文", 2, 12_000);
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE posts SET body_markdown = ?, updated_at = ? WHERE id = ?").bind(
      bodyMarkdown,
      timestamp,
      postId,
    ),
    env.DB.prepare(
      "UPDATE topics SET updated_at = ?, last_activity_at = ? WHERE id = ?",
    ).bind(timestamp, timestamp, post.topic_id),
  ]);
  return jsonResponse(request, env, { ok: true, data: { id: postId } });
}

async function deletePost(request: Request, env: Env, postId: string): Promise<Response> {
  const user = await requireUser(request, env);
  const post = await env.DB.prepare(
    `SELECT p.id, p.topic_id, p.author_id, p.kind, t.accepted_post_id
     FROM posts p JOIN topics t ON t.id = p.topic_id
     WHERE p.id = ? AND p.deleted_at IS NULL`,
  )
    .bind(postId)
    .first<{
      id: string;
      topic_id: string;
      author_id: number;
      kind: PostRow["kind"];
      accepted_post_id: string | null;
    }>();
  if (!post) {
    throw new ApiError(404, "post_not_found", "没有找到这条内容。 ");
  }
  if (post.kind === "body") {
    throw new ApiError(409, "cannot_delete_body", "主题正文不能单独删除。 ");
  }
  if (post.author_id !== user.id && !isStaff(user)) {
    throw new ApiError(403, "forbidden", "只能删除自己的内容。 ");
  }
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE posts SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(
      timestamp,
      timestamp,
      postId,
    ),
    env.DB.prepare(
      `UPDATE topics SET reply_count = MAX(0, reply_count - 1),
       accepted_post_id = CASE WHEN accepted_post_id = ? THEN NULL ELSE accepted_post_id END,
       status = CASE WHEN accepted_post_id = ? AND kind = 'question' THEN 'open' ELSE status END,
       updated_at = ?, last_activity_at = ? WHERE id = ?`,
    ).bind(postId, postId, timestamp, timestamp, post.topic_id),
  ]);
  return jsonResponse(request, env, { ok: true, data: { deleted: true } });
}

async function reportPost(request: Request, env: Env, postId: string): Promise<Response> {
  const user = await requireUser(request, env);
  await rateLimit(request, env, `report:${user.id}`, 5, 3600);
  const input = await readJson<{ reason?: unknown }>(request);
  const reason = requiredText(input.reason, "举报原因", 5, 500);
  const exists = await env.DB.prepare(
    "SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL",
  )
    .bind(postId)
    .first();
  if (!exists) {
    throw new ApiError(404, "post_not_found", "没有找到这条内容。 ");
  }
  try {
    await env.DB.prepare(
      "INSERT INTO reports (id, post_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), postId, user.id, reason, now())
      .run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      throw new ApiError(409, "already_reported", "你已经举报过这条内容。 ");
    }
    throw error;
  }
  return jsonResponse(request, env, { ok: true, data: { reported: true } }, 201);
}

async function getPageThread(request: Request, env: Env): Promise<Response> {
  const pageKey = pageKeyFromRequest(request);
  const topic = await env.DB.prepare(
    "SELECT id FROM topics WHERE kind = 'page' AND page_key = ? AND deleted_at IS NULL",
  )
    .bind(pageKey)
    .first<{ id: string }>();
  if (!topic) {
    return jsonResponse(request, env, {
      ok: true,
      data: { page_key: pageKey, topic: null, posts: [] },
    });
  }
  const detail = await loadTopicDetail(env, topic.id);
  return jsonResponse(request, env, {
    ok: true,
    data: { page_key: pageKey, topic: detail?.topic ?? null, posts: detail?.posts ?? [] },
  });
}

async function createPageComment(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  await rateLimit(request, env, `comment:${user.id}`, 20, 600);
  const input = await readJson<{ path?: unknown; body?: unknown }>(request);
  const pageKey = normalizePageKey(requiredText(input.path, "页面路径", 1, 300));
  const bodyMarkdown = requiredText(input.body, "评论", 2, 6_000);
  const timestamp = now();
  const newTopicId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO topics
      (id, kind, page_key, title, author_id, status, created_at, updated_at, last_activity_at)
     VALUES (?, 'page', ?, ?, ?, 'open', ?, ?, ?)`,
  )
    .bind(
      newTopicId,
      pageKey,
      `页面讨论：${pageKey}`,
      user.id,
      timestamp,
      timestamp,
      timestamp,
    )
    .run();

  const topic = await env.DB.prepare(
    "SELECT id FROM topics WHERE kind = 'page' AND page_key = ? AND deleted_at IS NULL",
  )
    .bind(pageKey)
    .first<{ id: string }>();
  if (!topic) {
    throw new ApiError(500, "page_thread_failed", "无法建立页面讨论。 ");
  }
  const postId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO posts
        (id, topic_id, author_id, kind, body_markdown, created_at, updated_at)
       VALUES (?, ?, ?, 'comment', ?, ?, ?)`,
    ).bind(postId, topic.id, user.id, bodyMarkdown, timestamp, timestamp),
    env.DB.prepare(
      `UPDATE topics SET reply_count = reply_count + 1,
       updated_at = ?, last_activity_at = ? WHERE id = ?`,
    ).bind(timestamp, timestamp, topic.id),
  ]);
  return jsonResponse(request, env, { ok: true, data: { id: postId } }, 201);
}

async function loadTopicDetail(
  env: Env,
  id: string,
): Promise<{ topic: ReturnType<typeof topicJson>; posts: ReturnType<typeof postJson>[] } | null> {
  const topic = await env.DB.prepare(
    `SELECT t.*, u.login AS author_login, u.display_name AS author_display_name,
       u.avatar_url AS author_avatar_url, u.profile_url AS author_profile_url,
       u.role AS author_role
     FROM topics t JOIN users u ON u.id = t.author_id
     WHERE t.id = ? AND t.deleted_at IS NULL`,
  )
    .bind(id)
    .first<TopicRow>();
  if (!topic) return null;

  const posts = await env.DB.prepare(
    `SELECT p.*, u.login AS author_login, u.display_name AS author_display_name,
       u.avatar_url AS author_avatar_url, u.profile_url AS author_profile_url,
       u.role AS author_role
     FROM posts p JOIN users u ON u.id = p.author_id
     WHERE p.topic_id = ? AND p.deleted_at IS NULL
     ORDER BY CASE p.kind WHEN 'body' THEN 0 ELSE 1 END, p.created_at ASC`,
  )
    .bind(id)
    .all<PostRow>();
  return { topic: topicJson(topic), posts: posts.results.map(postJson) };
}

async function getSessionUser(request: Request, env: Env): Promise<AppUser | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const user = await env.DB.prepare(
    `SELECT u.id, u.github_id, u.login, u.display_name, u.avatar_url, u.profile_url, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), now())
    .first<AppUser>();
  return user ?? null;
}

async function requireUser(request: Request, env: Env): Promise<AppUser> {
  const user = await getSessionUser(request, env);
  if (!user) {
    throw new ApiError(401, "authentication_required", "请先使用 GitHub 登录。 ");
  }
  return user;
}

function topicJson(row: TopicRow) {
  return {
    id: row.id,
    kind: row.kind,
    page_key: row.page_key,
    category: row.category,
    title: row.title,
    status: row.status,
    accepted_post_id: row.accepted_post_id,
    reply_count: row.reply_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_activity_at: row.last_activity_at,
    body_excerpt: row.body_excerpt || "",
    author: authorJson(row),
  };
}

function postJson(row: PostRow) {
  return {
    id: row.id,
    topic_id: row.topic_id,
    kind: row.kind,
    body_markdown: row.body_markdown,
    created_at: row.created_at,
    updated_at: row.updated_at,
    author: authorJson(row),
  };
}

function authorJson(row: TopicRow | PostRow) {
  return {
    id: row.author_id,
    login: row.author_login,
    display_name: row.author_display_name,
    avatar_url: row.author_avatar_url,
    profile_url: row.author_profile_url,
    role: row.author_role,
  };
}

function isStaff(user: AppUser): boolean {
  return user.role === "moderator" || user.role === "admin";
}

function validStatusForKind(kind: TopicKind, status: string): boolean {
  return kind === "question"
    ? new Set(["open", "answered", "closed"]).has(status)
    : PROPOSAL_STATUSES.has(status);
}

function pageKeyFromRequest(request: Request): string {
  const value = new URL(request.url).searchParams.get("path");
  if (!value) {
    throw new ApiError(400, "missing_page_path", "缺少页面路径。 ");
  }
  return normalizePageKey(value);
}

function normalizePageKey(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new ApiError(400, "invalid_page_path", "页面路径格式无效。 ");
  }
  const withoutQuery = decoded.split(/[?#]/, 1)[0];
  if (!withoutQuery.startsWith("/") || withoutQuery.length > 300 || withoutQuery.includes("..")) {
    throw new ApiError(400, "invalid_page_path", "页面路径格式无效。 ");
  }
  return withoutQuery.replace(/\/{2,}/g, "/");
}

async function readJson<T>(request: Request): Promise<T> {
  const declared = integer(request.headers.get("content-length"), 0);
  if (declared > MAX_BODY_BYTES) {
    throw new ApiError(413, "body_too_large", "提交内容过长。 ");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "body_too_large", "提交内容过长。 ");
  }
  try {
    return JSON.parse(text || "{}") as T;
  } catch {
    throw new ApiError(400, "invalid_json", "提交的数据格式无效。 ");
  }
}

function requiredText(
  value: unknown,
  label: string,
  minLength: number,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_input", `${label}不能为空。`);
  }
  const normalized = value.trim();
  if (normalized.length < minLength) {
    throw new ApiError(400, "invalid_input", `${label}至少需要 ${minLength} 个字符。`);
  }
  if (normalized.length > maxLength) {
    throw new ApiError(400, "invalid_input", `${label}不能超过 ${maxLength} 个字符。`);
  }
  return normalized;
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function safeGithubAvatar(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "avatars.githubusercontent.com"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function safeReturnTo(value: string | null, env: Env): string {
  const fallback = new URL("/community/qa/", env.WIKI_ORIGIN).toString();
  if (!value) return fallback;
  try {
    const target = new URL(value);
    return allowedOrigins(env).has(target.origin) ? target.toString() : fallback;
  } catch {
    return fallback;
  }
}

function requireGithubConfig(env: Env, needsSecret: boolean): void {
  if (!env.GITHUB_CLIENT_ID || env.GITHUB_CALLBACK_URL.includes("REPLACE_ME")) {
    throw new ApiError(503, "oauth_not_configured", "GitHub 登录正在配置中，请稍后再试。 ");
  }
  if (needsSecret && !env.GITHUB_CLIENT_SECRET) {
    throw new ApiError(503, "oauth_not_configured", "GitHub 登录正在配置中，请稍后再试。 ");
  }
}

async function rateLimit(
  request: Request,
  env: Env,
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  const bucketKey = await sha256(`${scope}:${address}`);
  const timestamp = now();
  const resetBefore = timestamp - windowSeconds;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket_key, count, window_started_at)
     VALUES (?, 1, ?)
     ON CONFLICT(bucket_key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_started_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
       window_started_at = CASE
         WHEN rate_limits.window_started_at <= ? THEN excluded.window_started_at
         ELSE rate_limits.window_started_at END
     RETURNING count`,
  )
    .bind(bucketKey, timestamp, resetBefore, resetBefore)
    .first<{ count: number }>();
  if ((row?.count ?? 1) > limit) {
    throw new ApiError(429, "rate_limited", "操作过于频繁，请稍后再试。 ");
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length >= 20 && token.length <= 200 ? token : null;
}

function adminGithubIds(env: Env): Set<number> {
  return new Set(
    (env.ADMIN_GITHUB_IDS || "")
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter(Number.isSafeInteger),
  );
}

function allowedOrigins(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS || env.WIKI_ORIGIN)
      .split(",")
      .map((value) => value.trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
}

function corsOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("origin");
  return origin && allowedOrigins(env).has(origin) ? origin : null;
}

function preflightResponse(request: Request, env: Env): Response {
  const origin = corsOrigin(request, env);
  if (!origin) {
    throw new ApiError(403, "origin_not_allowed", "该网站来源无权调用社区接口。 ");
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}

function jsonResponse(
  request: Request,
  env: Env,
  body: unknown,
  status = 200,
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  const origin = corsOrigin(request, env);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function integer(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function randomToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64Url(bytes);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
