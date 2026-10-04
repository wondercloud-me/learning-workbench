# 学习工作台原创图标

图标来自仓库已有的 `assets/icon.png` 和 `assets/Growth.iconset/icon_512x512.png`；未使用第三方图片或生成式图片。

- `icon-192.png`：原项目图标经 macOS sips 缩放到 192×192。
- `icon-512.png`：原项目 512×512 图标原样复制。
- `maskable-512.png`：原图标缩放到 280×280，居中置于 512×512、#111827 背景中。前景完整位于中心边长 280 的正方形内，最远角到中心约 198 px，小于 maskable safe zone 半径 204.8 px（尺寸的 40%）。

可重做：`sips -z 192 192 assets/icon.png --out browser/public/icons/icon-192.png`；512 图标从上述原资源复制；maskable 先用 `sips -z 280 280` 缩放，再用 `sips -p 512 512 --padColor 111827` 居中补边。中间文件仅放系统临时目录。
