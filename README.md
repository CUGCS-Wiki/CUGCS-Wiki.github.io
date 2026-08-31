# CUGCS Wiki

CUGCS Wiki 是一个面向中国地质大学（武汉）计算机学习共同体的开放知识库，首期覆盖课程学习、竞赛资料、科研经验和保研经验。

在线地址：<https://cugcs-wiki.github.io/>

## 技术方案

本站使用 MkDocs 与 Material for MkDocs 构建，参考 `csdiy.wiki` 和 OI-Wiki 的知识组织方式，但不复制其品牌、正文、图片或定制代码。Markdown 源文件位于 `docs/`，导航统一维护在 `mkdocs.yml`，推送到 `main` 分支后由 GitHub Actions 自动发布到 GitHub Pages。

社区采用独立的 Cloudflare Worker 与 D1 数据库。GitHub OAuth 只确认公开身份，问题、回答、共建提案、状态和页面评论都在本站完成，不依赖 GitHub Discussions。浏览器只保存短期站内会话凭证，不保存 GitHub 访问令牌；GitHub OAuth 密钥只存在于 Cloudflare Secret 中。

## 本地预览

需要 Python 3.10 或更高版本。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
mkdocs serve
```

浏览器访问 <http://127.0.0.1:8000/> 即可预览。

## 内容结构

```text
docs/
├── courses/          # 课程学习
├── competitions/     # 竞赛资料
├── research/         # 科研经验
├── postgraduate/     # 保研经验
├── community/        # 问答、共建孵化与社区规则
├── contributing/     # 贡献与写作规范
├── assets/           # 本站自有样式与脚本
├── about.md
└── index.md
```

提问和共建提案请进入[社区](https://cugcs-wiki.github.io/community/)，贡献内容前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 许可

`docs/` 下的原创内容默认采用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hans)；本站自有配置、脚本和样式采用 MIT 许可证。第三方材料仍归原权利人所有，必须单独注明来源与授权状态。
