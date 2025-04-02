# Neuro-Page

基本没了解过HTML和JS，全部代码💩使用DeepSeek-R1生成和完善

## 主要部分

```./scripts/updater.js```

利用Github Action，自动从Neuro官方Discord频道获取直播时间表图片、从TwitchTracker（有待研究）和Bilibili获取粉丝数量

```./index.html```

一个简单的静态页面，调用和展示获取到的内容

## 已知问题

- TwitchTracker获取粉丝数功能不可用，暂时写死数值

- Index网页暗色模式有问题，有待调整

- Action并没有在每小时的21分触发，不过反正能用，先不管它

- 关注Vedal喵，关注Vedal谢谢喵
