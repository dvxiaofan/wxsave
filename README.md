# wxsave

把微信公众号文章完整归档为单个离线 HTML 文件，即使原文被删也能原样查看。

解决的问题：
- 公众号图片防盗链（需要 `Referer`）
- 懒加载图片 `data-src` → `src` 的替换
- 发布时间自动提取，用作文件名前缀
- 排版 100% 还原（不做 Markdown 转换这种有损操作）

## 安装

```bash
# 1) 依赖
npm install -g single-file-cli

# 2) 克隆本仓库后
cd wxsave
./install.sh
```

`install.sh` 会把 `bin/wxsave` 软链到 `~/.local/bin/wxsave`。确认 `~/.local/bin` 在你的 `PATH` 里即可。

## 使用

```bash
wxsave https://mp.weixin.qq.com/s/XXXXXXXXXXXXXXXXXX
```

- 默认保存到 `~/Documents/wechat-archive/`
- 文件名格式：`YYYY-MM-DD_文章标题.html`（日期取自文章实际发布时间，取不到时回退到今天）
- 可用环境变量 `WXSAVE_OUTPUT_DIR` 改保存目录：

```bash
WXSAVE_OUTPUT_DIR=~/Dropbox/wechat wxsave https://mp.weixin.qq.com/s/...
```

## 工作原理

1. **SingleFile CLI** 驱动 headless Chrome，加 `Referer=https://mp.weixin.qq.com/` 解决防盗链，把页面打包成自包含单文件 HTML（CSS/字体全内联）。
2. **浏览器内脚本** (`lib/wxsave-helper.js`) 先滚动到底触发懒加载，再把所有 `img[data-src]` 替换为真实 URL，尽可能让 SingleFile 把图片抓下来。
3. **Node 后处理** (`lib/wxsave-postprocess.js`) 扫描输出文件，对仍有 `data-src` 但没有真实 `src` 的图片，直接在 Node 里 `fetch` 下来转 base64 内联（没 CORS 限制）。同时提取 `<em id=publish_time>` 里的发布日期，用作文件名前缀。

## 项目结构

```
wxsave/
├── bin/
│   └── wxsave              # zsh 入口脚本
├── lib/
│   ├── wxsave-helper.js    # 浏览器内注入脚本（懒加载处理）
│   └── wxsave-postprocess.js  # Node 后处理（图片 fetch + 重命名）
├── install.sh              # 软链到 ~/.local/bin
└── README.md
```

## 依赖

- Node.js 18+（需要内置 `fetch`）
- [single-file-cli](https://github.com/gildas-lormeau/single-file-cli) 2.x
- Google Chrome 或 Chromium

## License

MIT
