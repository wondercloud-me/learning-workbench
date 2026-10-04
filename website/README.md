# 学习工作台官网

原创静态中文官网，独立于 Electron 产品构建。无外部字体、图片或统计脚本。

## 本地预览

在仓库根目录执行：

```sh
node website/verify.mjs
python3 -m http.server 4174 --directory website --bind 127.0.0.1
```

打开 `http://127.0.0.1:4174`。ES modules 需要通过 HTTP 读取，不使用 `file://`。

## 配置公开入口

只改 `config.js`。`repositoryUrl` 未配置时，入口跳到页面内的项目状态。仓库已真实公开后可填写其 HTTPS 地址，源码、README、Actions、主许可与第三方说明自动从该地址生成；也可以分别设置对应地址。

`releaseUrl` 仅在构建通过且完成相应分发验收后填写。为空时显示「查看平台进度」，不会提供假安装包。具体平台文案在 `index.html`，更新时必须按实际设备、签名和分发状态说明。

官网不请求模型 API，也不存储学习数据或 API Key。隐私内容说明的是桌面产品行为。首屏为代码绘制的流程示意，不能当作应用实测截图。

## GitHub Pages

`.github/workflows/pages.yml` 在 main 上相关文件变动或手动触发时运行：检查静态站，配置 Pages，上传 `website/`，部署。仓库需要在 Settings → Pages 中选择 GitHub Actions；工作流不会强制修改该设置。标准 `github-pages` environment 保留 GitHub 的部署保护规则。

全站资源使用相对路径，适用于仓库 Pages 子路径。`verify.mjs` 检查页面锚点、相对文件、重复 ID、外部资产和链接配置；它不能替代真实浏览器的桌面、窄屏、键盘与屏幕阅读器检查。
