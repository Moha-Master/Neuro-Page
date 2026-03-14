# Neuro-Page

现代化的Python前后端项目，用于跟踪Vedal的直播时间表和粉丝数据。

## 功能

- 使用Discord.py从Discord频道获取最新直播时间表图片
- 获取Twitch和Bilibili粉丝数量
- 使用FastAPI + Uvicorn托管前端页面
- 支持定时更新或单次更新模式

## 配置

参照 `config.yaml` 文件

## 运行

1. 安装依赖：
   ```bash
   python -m venv venv
   (Linux and MacOS) venv/bin/pip install .
   (Windows) venv\Scripts\pip.exe install .
   ```

2. 配置 `config.yaml`

3. 运行：
   ```bash
   (Linux and MacOS) venv\bin\python main.py
   (Windows) venv\Scripts\python.exe main.py
   ```

服务器将在配置的端口启动，前端页面可在浏览器访问。

## 已知问题

- Index网页暗色模式有问题，有待调整
