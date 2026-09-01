(() => {
  "use strict";

  const API_BASE = "https://cugcs-wiki-community.mzh9966.workers.dev/api/v1";
  const TOKEN_KEY = "cugcs_community_session";
  const CATEGORY_LABELS = {
    courses: "课程学习",
    competitions: "竞赛训练",
    research: "科研与工程",
    postgraduate: "保研与升学",
    campus: "校园学习生活",
    other: "其他",
  };
  const STATUS_LABELS = {
    open: "待回答",
    answered: "已解决",
    closed: "已关闭",
    collecting: "征集中",
    evidence_needed: "待补证据",
    accepted: "已采纳",
    drafting: "撰写中",
    reviewing: "评审中",
    published: "已收录",
    paused: "暂时搁置",
  };
  const PROPOSAL_NEXT = {
    collecting: ["evidence_needed", "accepted", "paused"],
    evidence_needed: ["collecting", "accepted", "paused"],
    accepted: ["drafting", "collecting", "paused"],
    drafting: ["reviewing", "accepted", "paused"],
    reviewing: ["drafting", "published", "paused"],
    published: ["reviewing"],
    paused: ["collecting", "evidence_needed", "accepted", "drafting"],
  };

  let currentUser = null;
  let authLoaded = false;
  let bootSequence = 0;

  class ApiError extends Error {
    constructor(message, status, code) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError("社区服务返回了无法识别的数据。", response.status, "invalid_response");
    }
    if (!response.ok || !payload.ok) {
      if (response.status === 401) {
        sessionStorage.removeItem(TOKEN_KEY);
        currentUser = null;
      }
      throw new ApiError(
        payload?.error?.message || "社区服务暂时不可用。",
        response.status,
        payload?.error?.code || "request_failed",
      );
    }
    return payload.data;
  }

  async function exchangeAuthCode() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const code = params.get("cugcs_auth_code");
    if (!code) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    const result = await api("/auth/exchange", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    sessionStorage.setItem(TOKEN_KEY, result.token);
  }

  async function loadCurrentUser() {
    if (authLoaded) return currentUser;
    authLoaded = true;
    try {
      const data = await api("/me");
      currentUser = data.user;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      currentUser = null;
    }
    return currentUser;
  }

  function login() {
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    window.location.assign(
      `${API_BASE}/auth/github/start?return_to=${encodeURIComponent(returnTo)}`,
    );
  }

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      sessionStorage.removeItem(TOKEN_KEY);
      currentUser = null;
      authLoaded = true;
      await boot();
    }
  }

  function h(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "checked") node.checked = Boolean(value);
      else if (key === "disabled") node.disabled = Boolean(value);
      else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, String(value));
    });
    const list = Array.isArray(children) ? children : [children];
    list.forEach((child) => {
      if (child === null || child === undefined) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function clear(node) {
    node.replaceChildren();
  }

  function button(label, className, onClick, type = "button") {
    return h("button", { type, class: className, onClick, text: label });
  }

  function avatar(user, size = "normal") {
    const image = h("img", {
      class: `cugcs-community-avatar cugcs-community-avatar--${size}`,
      alt: "",
      loading: "lazy",
      referrerpolicy: "no-referrer",
    });
    if (user.avatar_url) image.src = user.avatar_url;
    return image;
  }

  function displayName(user) {
    return user.display_name || user.login;
  }

  function authBar(compact = false) {
    const bar = h("div", { class: `cugcs-auth${compact ? " cugcs-auth--compact" : ""}` });
    if (!currentUser) {
      bar.append(
        h("span", { class: "cugcs-auth__hint", text: "公开阅读，登录后可参与。" }),
        button("使用 GitHub 登录", "cugcs-button cugcs-button--primary", login),
      );
      return bar;
    }
    const profile = h(
      "a",
      {
        class: "cugcs-auth__profile",
        href: currentUser.profile_url,
        target: "_blank",
        rel: "noopener noreferrer",
      },
      [avatar(currentUser, "small"), h("span", { text: `@${currentUser.login}` })],
    );
    bar.append(profile, button("退出", "cugcs-button cugcs-button--quiet", logout));
    return bar;
  }

  function statusBadge(status) {
    return h("span", {
      class: `cugcs-community-status cugcs-community-status--${status}`,
      text: STATUS_LABELS[status] || status,
    });
  }

  function formatTime(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp * 1000);
    const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return "刚刚";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} 天前`;
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  function appendLinkedText(parent, text) {
    const pattern = /https?:\/\/[^\s<>()]+/g;
    let start = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > start) parent.append(document.createTextNode(text.slice(start, match.index)));
      try {
        const url = new URL(match[0]);
        parent.append(
          h("a", {
            href: url.toString(),
            target: "_blank",
            rel: "noopener noreferrer nofollow",
            text: match[0],
          }),
        );
      } catch {
        parent.append(document.createTextNode(match[0]));
      }
      start = match.index + match[0].length;
    }
    if (start < text.length) parent.append(document.createTextNode(text.slice(start)));
  }

  function renderMarkdown(markdown) {
    const container = h("div", { class: "cugcs-community-markdown" });
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    let inCode = false;
    let codeLines = [];
    let list = null;

    const flushCode = () => {
      if (!codeLines.length) return;
      container.append(h("pre", {}, h("code", { text: codeLines.join("\n") })));
      codeLines = [];
    };

    lines.forEach((line) => {
      if (line.trim().startsWith("```")) {
        if (inCode) flushCode();
        inCode = !inCode;
        list = null;
        return;
      }
      if (inCode) {
        codeLines.push(line);
        return;
      }
      if (!line.trim()) {
        list = null;
        return;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        if (!list) {
          list = h("ul");
          container.append(list);
        }
        const item = h("li");
        appendLinkedText(item, line.replace(/^\s*[-*]\s+/, ""));
        list.append(item);
        return;
      }
      list = null;
      if (/^>\s?/.test(line)) {
        const quote = h("blockquote");
        appendLinkedText(quote, line.replace(/^>\s?/, ""));
        container.append(quote);
        return;
      }
      const paragraph = h("p");
      appendLinkedText(paragraph, line);
      container.append(paragraph);
    });
    if (inCode) flushCode();
    return container;
  }

  function loading(label = "正在连接社区服务…") {
    return h("div", { class: "cugcs-community-loading", text: label });
  }

  function notice(message, kind = "info") {
    return h("div", {
      class: `cugcs-community-notice cugcs-community-notice--${kind}`,
      role: kind === "error" ? "alert" : "status",
      text: message,
    });
  }

  function errorPanel(error, retry) {
    const message = error instanceof Error ? error.message : "社区服务暂时不可用。";
    return h("div", { class: "cugcs-community-error", role: "alert" }, [
      h("strong", { text: "加载失败" }),
      h("p", { text: message }),
      retry ? button("重新加载", "cugcs-button cugcs-button--secondary", retry) : null,
    ]);
  }

  function field(labelText, control, hint = "") {
    const label = h("label", { class: "cugcs-community-field" }, [
      h("span", { class: "cugcs-community-field__label", text: labelText }),
      control,
    ]);
    if (hint) label.append(h("small", { text: hint }));
    return label;
  }

  function categorySelect(name = "category") {
    const select = h("select", { name, required: true });
    Object.entries(CATEGORY_LABELS).forEach(([value, label]) => {
      select.append(h("option", { value, text: label }));
    });
    return select;
  }

  function topicCard(topic) {
    const href = `${window.location.pathname}?id=${encodeURIComponent(topic.id)}`;
    const title = h("a", {
      class: "cugcs-topic-card__title",
      href,
      text: topic.title,
    });
    const author = h("span", { class: "cugcs-topic-card__author" }, [
      avatar(topic.author, "tiny"),
      h("span", { text: displayName(topic.author) }),
    ]);
    return h("article", { class: "cugcs-topic-card" }, [
      h("div", { class: "cugcs-topic-card__badges" }, [
        statusBadge(topic.status),
        h("span", {
          class: "cugcs-community-category",
          text: CATEGORY_LABELS[topic.category] || "其他",
        }),
      ]),
      title,
      h("p", {
        class: "cugcs-topic-card__excerpt",
        text: topic.body_excerpt || "查看主题详情与社区讨论。",
      }),
      h("div", { class: "cugcs-topic-card__meta" }, [
        author,
        h("span", { text: `${topic.reply_count} 条回复` }),
        h("time", {
          datetime: new Date(topic.last_activity_at * 1000).toISOString(),
          text: formatTime(topic.last_activity_at),
        }),
      ]),
    ]);
  }

  async function renderCollection(root, kind) {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) {
      await renderTopicDetail(root, id, kind);
      return;
    }

    clear(root);
    const title = kind === "question" ? "站内问答" : "共建提案";
    const description =
      kind === "question"
        ? "问题、回答和采纳状态都保留在本站，不会跳转到 GitHub Discussions。"
        : "在这里发起主题、汇集建议并推进为 Wiki 正文，全程保留明确的状态。";
    const createButton = button(
      kind === "question" ? "提出问题" : "发起共建",
      "cugcs-button cugcs-button--primary",
      () => {
        if (!currentUser) return login();
        composer.hidden = !composer.hidden;
        if (!composer.hidden) composer.querySelector("input")?.focus();
      },
    );
    const header = h("div", { class: "cugcs-community-header" }, [
      h("div", {}, [h("h2", { text: title }), h("p", { text: description })]),
      h("div", { class: "cugcs-community-header__actions" }, [authBar(), createButton]),
    ]);

    const composer = topicComposer(kind, async (payload, statusNode) => {
      try {
        statusNode.replaceChildren(loading("正在发布…"));
        const result = await api("/topics", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        window.location.assign(`${window.location.pathname}?id=${encodeURIComponent(result.id)}`);
      } catch (error) {
        statusNode.replaceChildren(errorPanel(error));
      }
    });
    composer.hidden = true;

    const filters = h("form", { class: "cugcs-community-filters" });
    const searchInput = h("input", {
      type: "search",
      name: "q",
      placeholder: kind === "question" ? "搜索问题" : "搜索共建主题",
      "aria-label": "搜索",
    });
    const category = categorySelect("category");
    category.insertBefore(h("option", { value: "", text: "全部分类" }), category.firstChild);
    category.value = "";
    const status = h("select", { name: "status", "aria-label": "状态" });
    status.append(h("option", { value: "", text: "全部状态" }));
    const statusValues =
      kind === "question" ? ["open", "answered"] : Array.from(Object.keys(PROPOSAL_NEXT));
    statusValues.forEach((value) =>
      status.append(h("option", { value, text: STATUS_LABELS[value] || value })),
    );
    filters.append(
      searchInput,
      category,
      status,
      button("筛选", "cugcs-button cugcs-button--secondary", null, "submit"),
    );

    const results = h("div", { class: "cugcs-topic-list" }, loading());
    const load = async () => {
      results.replaceChildren(loading());
      const query = new URLSearchParams({ kind, limit: "50" });
      if (searchInput.value.trim()) query.set("q", searchInput.value.trim());
      if (category.value) query.set("category", category.value);
      if (status.value) query.set("status", status.value);
      try {
        const data = await api(`/topics?${query.toString()}`);
        if (!data.topics.length) {
          results.replaceChildren(
            notice(kind === "question" ? "还没有符合条件的问题。" : "还没有符合条件的共建提案。"),
          );
          return;
        }
        results.replaceChildren(...data.topics.map(topicCard));
      } catch (error) {
        results.replaceChildren(errorPanel(error, load));
      }
    };
    filters.addEventListener("submit", (event) => {
      event.preventDefault();
      load();
    });
    root.append(header, composer, filters, results);
    await load();
  }

  function topicComposer(kind, onSubmit) {
    const form = h("form", { class: "cugcs-community-composer" });
    const titleInput = h("input", {
      name: "title",
      type: "text",
      minlength: "8",
      maxlength: "120",
      required: true,
      placeholder: kind === "question" ? "一句话说明你遇到的问题" : "一句话说明希望共同完善的主题",
    });
    const category = categorySelect();
    const body = h("textarea", {
      name: "body",
      rows: "8",
      minlength: "20",
      maxlength: "12000",
      required: true,
      placeholder:
        kind === "question"
          ? "请说明背景、已经尝试过的方法，以及希望得到什么帮助。"
          : "请说明缺失内容、目标读者、已有资料、需要哪些协作，以及怎样才算完成。",
    });
    const status = h("div", { class: "cugcs-community-form-status", "aria-live": "polite" });
    form.append(
      h("h3", { text: kind === "question" ? "提出新问题" : "发起共建提案" }),
      field("标题", titleInput, "8 至 120 个字符，写清对象和具体诉求。"),
      field("分类", category),
      field("正文", body, "支持普通文本、列表、引用和代码块；请勿提交个人隐私或内部资料。"),
      h("div", { class: "cugcs-community-form-actions" }, [
        button("发布", "cugcs-button cugcs-button--primary", null, "submit"),
      ]),
      status,
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!currentUser) return login();
      await onSubmit(
        {
          kind,
          title: titleInput.value,
          category: category.value,
          body: body.value,
        },
        status,
      );
    });
    return form;
  }

  async function renderTopicDetail(root, id, expectedKind) {
    clear(root);
    root.append(loading("正在加载主题…"));
    try {
      const data = await api(`/topics/${encodeURIComponent(id)}`);
      const topic = data.topic;
      if (topic.kind !== expectedKind) throw new Error("主题类型与当前页面不一致。 ");
      const bodyPost = data.posts.find((post) => post.kind === "body");
      const replies = data.posts.filter((post) => post.kind !== "body");
      const canManage =
        currentUser &&
        (currentUser.id === topic.author.id || ["moderator", "admin"].includes(currentUser.role));

      const back = h("a", {
        class: "cugcs-community-back",
        href: window.location.pathname,
        text: expectedKind === "question" ? "← 返回问答广场" : "← 返回共建孵化",
      });
      const heading = h("header", { class: "cugcs-topic-detail__header" }, [
        h("div", { class: "cugcs-topic-card__badges" }, [
          statusBadge(topic.status),
          h("span", {
            class: "cugcs-community-category",
            text: CATEGORY_LABELS[topic.category] || "其他",
          }),
        ]),
        h("h2", { text: topic.title }),
        authorLine(topic.author, topic.created_at),
      ]);

      const detail = h("article", { class: "cugcs-topic-detail" }, [
        heading,
        bodyPost ? renderPost(bodyPost, topic) : notice("正文已不可用。", "warning"),
      ]);

      if (expectedKind === "proposal" && canManage) {
        const transitions = PROPOSAL_NEXT[topic.status] || [];
        if (transitions.length) detail.append(proposalTransition(topic, transitions, root, expectedKind));
      }

      const replySection = h("section", { class: "cugcs-replies" }, [
        h("div", { class: "cugcs-replies__heading" }, [
          h("h3", { text: expectedKind === "question" ? `回答（${replies.length}）` : `讨论（${replies.length}）` }),
          authBar(true),
        ]),
      ]);
      const list = h("div", { class: "cugcs-post-list" });
      if (!replies.length) {
        list.append(
          notice(expectedKind === "question" ? "还没有回答，你可以成为第一个回答者。" : "还没有建议，你可以补充第一条。"),
        );
      } else {
        replies.forEach((post) => {
          const wrapper = renderPost(post, topic);
          if (
            expectedKind === "question" &&
            canManage &&
            topic.accepted_post_id !== post.id
          ) {
            wrapper.append(
              button("采纳这个回答", "cugcs-button cugcs-button--accept", async () => {
                try {
                  await api(`/topics/${topic.id}/accept`, {
                    method: "POST",
                    body: JSON.stringify({ post_id: post.id }),
                  });
                  await renderTopicDetail(root, id, expectedKind);
                } catch (error) {
                  wrapper.append(errorPanel(error));
                }
              }),
            );
          }
          list.append(wrapper);
        });
      }
      replySection.append(list, replyComposer(topic, root, expectedKind));
      clear(root);
      root.append(back, detail, replySection);
    } catch (error) {
      root.replaceChildren(
        h("a", { class: "cugcs-community-back", href: window.location.pathname, text: "← 返回列表" }),
        errorPanel(error, () => renderTopicDetail(root, id, expectedKind)),
      );
    }
  }

  function authorLine(author, timestamp) {
    return h("div", { class: "cugcs-community-author" }, [
      avatar(author, "small"),
      h("div", {}, [
        h("a", {
          href: author.profile_url,
          target: "_blank",
          rel: "noopener noreferrer",
          text: displayName(author),
        }),
        h("span", { text: `@${author.login} · ${formatTime(timestamp)}` }),
      ]),
      author.role !== "member"
        ? h("span", { class: "cugcs-community-role", text: author.role === "admin" ? "管理员" : "维护者" })
        : null,
    ]);
  }

  function renderPost(post, topic) {
    const accepted = topic.accepted_post_id === post.id;
    const article = h("article", {
      class: `cugcs-post${accepted ? " cugcs-post--accepted" : ""}`,
    });
    article.append(
      h("header", { class: "cugcs-post__header" }, [
        authorLine(post.author, post.created_at),
        accepted ? h("strong", { class: "cugcs-post__accepted", text: "已采纳" }) : null,
      ]),
      renderMarkdown(post.body_markdown),
    );

    const canEdit =
      currentUser &&
      (currentUser.id === post.author.id || ["moderator", "admin"].includes(currentUser.role));
    if (currentUser && post.kind !== "body") {
      const actions = h("div", { class: "cugcs-post__actions" });
      if (canEdit) {
        actions.append(
          button("编辑", "cugcs-button cugcs-button--text", () => editPostInline(article, post, topic)),
          button("删除", "cugcs-button cugcs-button--text-danger", async () => {
            if (!window.confirm("确定删除这条内容吗？删除后不会公开显示。")) return;
            try {
              await api(`/posts/${post.id}`, { method: "DELETE" });
              await boot();
            } catch (error) {
              article.append(errorPanel(error));
            }
          }),
        );
      } else {
        actions.append(
          button("举报", "cugcs-button cugcs-button--text", async () => {
            const reason = window.prompt("请简要说明举报原因（至少 5 个字符）：");
            if (!reason) return;
            try {
              await api(`/posts/${post.id}/report`, {
                method: "POST",
                body: JSON.stringify({ reason }),
              });
              actions.replaceChildren(notice("举报已提交，维护者会进行核查。"));
            } catch (error) {
              article.append(errorPanel(error));
            }
          }),
        );
      }
      article.append(actions);
    }
    return article;
  }

  function editPostInline(article, post, topic) {
    if (article.querySelector(".cugcs-inline-editor")) return;
    const editor = h("form", { class: "cugcs-inline-editor" });
    const textarea = h("textarea", { rows: "7", maxlength: "12000", required: true });
    textarea.value = post.body_markdown;
    const status = h("div", { "aria-live": "polite" });
    editor.append(
      textarea,
      h("div", { class: "cugcs-community-form-actions" }, [
        button("保存修改", "cugcs-button cugcs-button--primary", null, "submit"),
        button("取消", "cugcs-button cugcs-button--quiet", () => editor.remove()),
      ]),
      status,
    );
    editor.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api(`/posts/${post.id}`, {
          method: "PATCH",
          body: JSON.stringify({ body: textarea.value }),
        });
        await boot();
      } catch (error) {
        status.replaceChildren(errorPanel(error));
      }
    });
    article.append(editor);
    textarea.focus();
  }

  function proposalTransition(topic, transitions, root, expectedKind) {
    const panel = h("div", { class: "cugcs-proposal-transition" });
    const select = h("select", { "aria-label": "共建状态" });
    transitions.forEach((status) =>
      select.append(h("option", { value: status, text: STATUS_LABELS[status] || status })),
    );
    const statusNode = h("span", { "aria-live": "polite" });
    panel.append(
      h("strong", { text: "推进共建状态" }),
      select,
      button("确认变更", "cugcs-button cugcs-button--secondary", async () => {
        try {
          await api(`/topics/${topic.id}/transition`, {
            method: "POST",
            body: JSON.stringify({ status: select.value }),
          });
          await renderTopicDetail(root, topic.id, expectedKind);
        } catch (error) {
          statusNode.replaceChildren(errorPanel(error));
        }
      }),
      statusNode,
    );
    return panel;
  }

  function replyComposer(topic, root, expectedKind) {
    const form = h("form", { class: "cugcs-community-composer cugcs-community-composer--reply" });
    if (!currentUser) {
      form.append(
        h("p", { text: "登录后可以参与这条讨论。" }),
        button("使用 GitHub 登录", "cugcs-button cugcs-button--primary", login),
      );
      return form;
    }
    const textarea = h("textarea", {
      rows: "6",
      minlength: "2",
      maxlength: "12000",
      required: true,
      placeholder: expectedKind === "question" ? "写下你的回答和适用条件…" : "补充证据、案例、建议或可承担的工作…",
    });
    const status = h("div", { "aria-live": "polite" });
    form.append(
      field(expectedKind === "question" ? "写回答" : "参与讨论", textarea),
      button("发布回复", "cugcs-button cugcs-button--primary", null, "submit"),
      status,
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        status.replaceChildren(loading("正在发布…"));
        await api(`/topics/${topic.id}/posts`, {
          method: "POST",
          body: JSON.stringify({ body: textarea.value }),
        });
        await renderTopicDetail(root, topic.id, expectedKind);
      } catch (error) {
        status.replaceChildren(errorPanel(error));
      }
    });
    return form;
  }

  async function renderActivity(root) {
    clear(root);
    root.append(loading("正在汇总社区动态…"));
    try {
      const [questionData, proposalData] = await Promise.all([
        api("/topics?kind=question&limit=8"),
        api("/topics?kind=proposal&limit=8"),
      ]);
      const section = (heading, topics, emptyText, path) => {
        const block = h("section", { class: "cugcs-activity-block" }, [h("h2", { text: heading })]);
        if (!topics.length) block.append(notice(emptyText));
        else {
          const list = h("div", { class: "cugcs-topic-list" });
          topics.forEach((topic) => {
            const card = topicCard(topic);
            card.querySelector("a.cugcs-topic-card__title").href = `${path}?id=${encodeURIComponent(topic.id)}`;
            list.append(card);
          });
          block.append(list);
        }
        return block;
      };
      root.replaceChildren(
        h("div", { class: "cugcs-community-header" }, [
          h("div", {}, [
            h("h2", { text: "社区最新进展" }),
            h("p", { text: "这里直接读取站内数据库，不再依赖 GitHub Discussions 的构建快照。" }),
          ]),
          authBar(),
        ]),
        section("最近问答", questionData.topics, "还没有问题。", "/community/qa/"),
        section("正在共建", proposalData.topics, "还没有共建提案。", "/community/incubator/"),
      );
    } catch (error) {
      root.replaceChildren(errorPanel(error, () => renderActivity(root)));
    }
  }

  async function boot() {
    const sequence = ++bootSequence;
    try {
      await exchangeAuthCode();
      authLoaded = false;
      await loadCurrentUser();
    } catch (error) {
      document.querySelectorAll(".cugcs-community-app").forEach((root) => {
        root.replaceChildren(errorPanel(error));
      });
      return;
    }
    if (sequence !== bootSequence) return;

    const jobs = [];
    document.querySelectorAll(".cugcs-community-app").forEach((root) => {
      if (root.dataset.view === "questions") jobs.push(renderCollection(root, "question"));
      else if (root.dataset.view === "proposals") jobs.push(renderCollection(root, "proposal"));
      else if (root.dataset.view === "activity") jobs.push(renderActivity(root));
    });
    await Promise.allSettled(jobs);
  }

  if (typeof document$ !== "undefined" && document$?.subscribe) {
    document$.subscribe(() => boot());
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
