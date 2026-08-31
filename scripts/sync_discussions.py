#!/usr/bin/env python3
"""Build a static community activity page from GitHub Discussions."""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


OWNER = "CUGCS-Wiki"
REPOSITORY = "CUGCS-Wiki.github.io"
OUTPUT = Path(__file__).resolve().parents[1] / "docs" / "community" / "activity.md"
GRAPHQL_ENDPOINT = "https://api.github.com/graphql"
ALLOWED_URL_PREFIX = f"https://github.com/{OWNER}/{REPOSITORY}/discussions/"

QUERY = """
query CommunityActivity($owner: String!, $name: String!, $count: Int!) {
  repository(owner: $owner, name: $name) {
    discussions(first: $count, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        title
        url
        updatedAt
        upvoteCount
        answer { id }
        category { name slug isAnswerable }
        comments { totalCount }
      }
    }
  }
}
"""


def markdown_escape(value: str) -> str:
    """Keep untrusted discussion titles inside plain Markdown link text."""
    value = re.sub(r"[\r\n\t]+", " ", value).strip()
    return re.sub(r"([\\`*_{}\[\]()<>#+.!|~-])", r"\\\1", value)


def safe_url(value: str) -> str:
    if not value.startswith(ALLOWED_URL_PREFIX):
        return f"https://github.com/{OWNER}/{REPOSITORY}/discussions"
    return value


def local_time(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M")


def fetch_discussions(token: str) -> list[dict]:
    payload = json.dumps(
        {
            "query": QUERY,
            "variables": {"owner": OWNER, "name": REPOSITORY, "count": 50},
        }
    ).encode("utf-8")
    request = Request(
        GRAPHQL_ENDPOINT,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "CUGCS-Wiki-community-builder",
        },
        method="POST",
    )
    with urlopen(request, timeout=20) as response:
        result = json.load(response)
    if result.get("errors"):
        raise RuntimeError(result["errors"][0].get("message", "GraphQL query failed"))
    return result["data"]["repository"]["discussions"]["nodes"]


def activity_block(items: list[dict], kind: str) -> str:
    if not items:
        if kind == "question":
            return "目前还没有问题。你可以成为第一个提问的人。\n"
        return "目前还没有共建提案。你可以发起第一个需要共同完善的主题。\n"

    lines = ['<div class="cugcs-activity-list">']
    for item in items[:12]:
        answered = bool(item.get("answer"))
        if kind == "question":
            status = "已解决" if answered else "待回答"
        else:
            status = "共建中"
        title = markdown_escape(item.get("title") or "未命名讨论")
        url = safe_url(item.get("url") or "")
        comments = int(item.get("comments", {}).get("totalCount", 0))
        votes = int(item.get("upvoteCount", 0))
        updated = local_time(item["updatedAt"])
        lines.extend(
            [
                '<div class="cugcs-activity-item">',
                f'<span class="cugcs-status">{status}</span><a href="{url}"><strong>{title}</strong></a>',
                f"<p>{comments} 条回复 · {votes} 个赞同 · 更新于 {updated}</p>",
                "</div>",
            ]
        )
    lines.append("</div>")
    return "\n".join(lines) + "\n"


def render(discussions: list[dict]) -> str:
    questions = [item for item in discussions if item.get("category", {}).get("slug") == "q-a"]
    proposals = [item for item in discussions if item.get("category", {}).get("slug") == "ideas"]
    unanswered = [item for item in questions if not item.get("answer")]
    generated = datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M")

    return f"""---
comments: false
---

# 社区动态

这里汇总最近更新的问答和共建提案。数据来自本仓库的 GitHub Discussions，在网站构建时更新。最后生成时间：{generated}。

[发起一个问题](https://github.com/{OWNER}/{REPOSITORY}/discussions/new?category=q-a){{ .md-button .md-button--primary }}
[发起共建提案](https://github.com/{OWNER}/{REPOSITORY}/discussions/new?category=ideas){{ .md-button }}

## 待回答问题

{activity_block(unanswered, "question")}
## 最近问答

{activity_block(questions, "question")}
## 正在共建

{activity_block(proposals, "proposal")}
!!! note "更新方式"
    新建、编辑、转移、采纳或取消采纳 Discussion 时会触发重新构建；此外网站每六小时同步一次。页面展示的是静态快照，发帖和回复仍在 GitHub Discussions 中完成。
"""


def main() -> int:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("未提供 GITHUB_TOKEN，保留现有社区动态页面。")
        return 0
    try:
        discussions = fetch_discussions(token)
        OUTPUT.write_text(render(discussions), encoding="utf-8")
    except (HTTPError, URLError, KeyError, RuntimeError, ValueError) as error:
        print(f"::warning::社区动态同步失败，保留现有页面：{error}", file=sys.stderr)
        return 0
    print(f"已生成 {OUTPUT}，读取 {len(discussions)} 条讨论。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
