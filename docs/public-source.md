# 公开源码快照

发布使用当前工作目录中的明确清单。导出脚本不读取或复制 `.git/`，也不携带本地提交历史。公开仓库应从这份新快照建立；原开发仓库中的历史不能据此视为已检查。

在项目根目录运行：

```sh
node scripts/export-public-source.mjs --output .cache/public-source-20261005-01
```

目标目录必须不存在。再次导出时换一个新目录名。也可以通过 `--source` 指定项目目录，通过 `--output` 写到项目之外的新目录。项目内部只允许写入 `.cache/` 下的新子目录；脚本不会覆盖现有目录。

成功时输出文件数和快照 SHA-256。快照根目录中的 `PUBLIC_SOURCE_MANIFEST.json` 列出每个公开文件的相对路径、字节数和 SHA-256，没有本机绝对路径。文件内容按原字节复制，不自动改写示例、教学文案或代码。整份清单的 SHA-256 来自按路径排序的 `files` 数组的紧凑 JSON；清单文件本身不参与递归散列。

## 允许的内容

| 范围 | 允许内容 |
| --- | --- |
| `src/` | TypeScript、JavaScript、CSS、JSON、HTML、SVG |
| `tests/` | 代码及 JSON、HTML、TXT 测试夹具 |
| `scripts/` | JS/TS、Python、Shell、PowerShell 维护脚本 |
| `assets/` | 图标、PNG/JPEG/WebP/GIF/SVG 图片、macOS entitlements |
| `browser/` | 手机/浏览器入口 HTML、Web App manifest、PNG/SVG 图标及 Markdown 来源说明 |
| `licenses/` | 许可证、NOTICE、COPYING、AUTHORS 与文本/JSON/HTML 许可清单 |
| `website/` | 静态官网的 HTML/CSS/JS、文本、配置、图片和校验脚本 |
| `.github/` | YAML 工作流和 Markdown/JSON 协作配置 |
| 根文件 | README、LICENSE、第三方说明、贡献/安全/变更说明、package、pnpm 锁文件/工作区配置、index、tsconfig、vite/vitest 配置（含 `vite.browser.config.ts`）和 `.gitignore` |
| `docs/` | 仅本文 `docs/public-source.md` |

根文件采用脚本中的完整文件名清单，不接受任意同类配置文件。README、LICENSE、package.json、pnpm-lock.yaml 是必需文件。README 的相对文件链接必须能在快照中找到；指向已排除文档的链接会阻止导出。

浏览器构建所需的 `browser/index.html`、`browser/public/manifest.webmanifest`、`browser/public/icons/` 的 PNG/SVG 图标和来源说明进入快照；`src/browser/` 与 `scripts/build-browser-sw.mjs` 沿用已有源码和脚本规则。浏览器所选文件同样逐字节扫描凭据、个人 home 路径和异常二进制，符号链接同样拒绝。

所选目录中新出现的扩展名、隐藏文件、空格或非 ASCII 文件名需要维护者先审阅并调整清单。图片检查常见文件头；非图片文本不能包含 NUL 字节。单文件上限 8 MiB，整份所选源码上限 64 MiB。二进制依赖和语音权重通过构建脚本下载，不进入源码快照。

## 排除与失败条件

`.git/`、`.cache/`、`node_modules/`、`resources/`、构建/发布目录（含 `dist-browser/`）不进入快照。即使放在所选目录内部，用户数据（含浏览器目录内的 `userData/`）、`personal/`、`private/`、备份、教材缓存、凭据和签名目录仍被排除；常见 `.env`、状态/模型备份 JSON、私钥、证书、数据库和备份文件也被排除。`docs/research/`、`docs/plans/`、`docs/superpowers/`、本机 QA 记录和课堂/个人工作区历史不在清单中。

所选文件或目录是符号链接时直接失败。脚本检查真实读取路径位于源码目录，并在读取时禁止跟随文件符号链接。校验与内容检查完成之后才创建目标目录；写入时使用已核对的真实路径，检查目录身份和实际父目录，文件采用排他创建。

写入失败会返回非零退出码，并保留未完成目录供检查；不会按可被并发替换的路径递归删除。路径检查能发现普通的目录替换，但不能承诺阻止所有并发路径竞态。只有成功退出且逐文件散列与清单一致的快照才能发布；清单最后写入。失败目录不可直接重用，下一次应选择新目录。

内容扫描覆盖常见 OpenAI/DeepSeek/Anthropic、GitHub、AWS、Google、Slack、Stripe token 形状、私钥头和带用户名密码的 HTTP URL。所选内容中的个人 home 路径也会阻止导出。诊断只输出类别及相对文件名，不输出命中值、内容片段或本机路径。

明确的 `YOUR_API_KEY`、短的虚构 Key、example/test/invalid 保留域名凭据 URL 可以原样保留，用于教学或校验示例。alice/bob/user 等常规虚构账户路径、localhost 凭据 URL，以及现有原站 URL 安全测试中的单字符用户名/密码 `x:y` 仅在 `tests/` 内允许。运行机器的真实账户路径不会享受这个例外。完整 token 形状即使出现在测试或示例域名 URL 里仍会被拒绝；安全测试应在运行时拼接虚构 token，而不是把完整形状写进仓库。

正则不能识别所有秘密、自定义 token 或正文中的个人信息。新增所选文件仍需维护者核对用途、来源和许可；导出成功仅证明该清单和这些格式检查通过。它不证明桌面安装包已签名、公证、经过 Windows/手机验收，也不授权再分发第三方网站正文。

## 验证

```sh
pnpm exec vitest run tests/public-source.test.ts
pnpm typecheck
```

测试使用临时目录与虚构内容，实际执行导出 CLI；浏览器导出测试还读取仓库的真实入口、配置、manifest、图标及来源说明，并核对副本字节和散列。覆盖公开内容与历史/用户数据隔离、逐文件字节和散列一致性、符号链接、意外文件类型、凭据失败诊断、假路径示例、README 链接和目标目录保护。公开前还应针对最终快照运行项目测试、构建和网站检查，并核对 `PUBLIC_SOURCE_MANIFEST.json` 后再建立公开提交。
