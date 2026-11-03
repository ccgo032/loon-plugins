# Loon 喜马拉雅开屏广告过滤

基于一次喜马拉雅 iOS **9.5.22** 的抓包，针对广告展示开关和仍被放行的 TME 广告请求编写。插件为可直接阅读的原生 Rewrite 配置，不包含 JavaScript、远程脚本、上报接口或证书私钥。

**当前状态：离线匹配与 JQ 测试通过；尚未在 iPhone 上验证 Loon 原生解析和实际开屏效果。** 这是待真机验证的首版，不能保证清除缓存素材、本地开屏和其他尚未捕获的广告链路。

## 安装

插件地址：

```text
https://raw.githubusercontent.com/ccgo032/loon-plugins/main/loon/ximalaya-splash.plugin
```

[查看插件源码](loon/ximalaya-splash.plugin) · [下载原始插件](https://raw.githubusercontent.com/ccgo032/loon-plugins/main/loon/ximalaya-splash.plugin)

1. 使用 **Loon 3.5.1 Build 978 或更高版本**。插件使用新版 Rewrite 语法。
2. 在 Loon 的插件页面通过添加 URL 的入口，粘贴上面的地址，下载后启用。
3. 首次测试时，**停用原有的“喜马拉雅去广告”专用插件**，避免同一接口被多份规则连续修改。通用分流规则可以保留；基础广告拦截插件也可以保留，但若要单独验证本插件效果，可暂时只测试本插件。
4. 确保证书由自己生成，已安装并被系统信任；开启 **复写、MitM、MitM over HTTP/2**，Loon 保持连接并处于规则模式。本插件不需要开启脚本。
5. 本插件声明的解密主机名只有 `mobwsa.ximalaya.com`、`tmeadkg.y.qq.com`。不要额外填写全域通配符 `*`，保持“跳过服务器证书验证”关闭。若网络使用 QUIC，需要开启 Loon 的 QUIC 回退保护；这并不保证所有请求都能回退。
6. 先使用喜马拉雅自带的清理缓存功能，保留需要的离线音频；随后从多任务界面完全退出喜马拉雅，再重新打开。暂不建议通过卸载来测试，以免丢失本地内容。
7. 分别测试冷启动、回到前台，以及登录、搜索、正常音频播放、已购内容和下载功能。Wi-Fi 与蜂窝网络各测试一次。

## 处理范围

| 处理 | 限定范围 | 动作 |
|---|---|---|
| 广告展示开关 | `GET https://mobwsa.ximalaya.com/mobile-resource-position/resource/advertising/free/v2` 的 HTTP 200 JSON 响应 | 仅在 `ret == 0`、`data` 为对象且已有 `data.isAdShow == true` 时，将该字段改成 `false` |
| TME 广告获取 | `POST https://tmeadkg.y.qq.com/maproxy/getAd` 或 `/maproxy/getPbCompressAd`，且 User-Agent 以 `ting/` 加数字开头 | 在本机返回 HTTP 204，阻止该广告请求发往上游 |

允许上述接口附带查询参数，但不匹配其他域名、子域名、相似路径、其他方法，以及不符合 User-Agent 条件的请求。JSON 错误响应、缺失字段和类型变化保持原样。

`isAdShow` 的具体客户端语义由喜马拉雅实现决定；从抓包能确认它是广告展示相关字段，但将它关闭能否消除当前开屏仍需要真机测试。TME 的 JSON 广告接口在本次抓包中已经返回空广告数组，不能据此认定它就是画面中广告的唯一来源。

## 隐私和局限

- 原始抓包只在本地分析，仓库中的测试数据是手写合成数据。没有上传 Cookie、Token、用户编号、设备标识、原始请求头、证书或抓包文件。
- 插件没有脚本、外部 Mock 文件、重定向、DNS 修改、全域拦截、会员状态修改或播放器逻辑修改。它不会主动将请求内容发送到另一个服务器。
- **MitM 按域名生效。** `tmeadkg.y.qq.com` 是共享广告 SDK 域名；即使规则动作由喜马拉雅的 User-Agent 限定，该域名上其他 App 的 HTTPS 请求仍可能进入 Loon 解密流程。Header 条件不等于 iOS 的按应用隔离，也不是身份认证。
- 未在手机上验证登录、播放和其他 App 的兼容性。SDK 可能改用其他广告接口，或使用本地缓存；HTTP 204 也可能触发其回退逻辑。新版本改变接口或 User-Agent 后，需要重新分析。
- 本插件只覆盖抓包证据对应的范围，不承诺移除首页推荐、音频中主播口播、所有播放器广告或 App 本地启动画面。
- 如出现联网、登录或播放问题，先停用本插件并重新打开 App。停用可以撤销之后的网络处理，但不会恢复之前已写入 App 缓存的数据。

## 如何验证是否命中

在 Loon 的请求记录中，关注两个上表接口。TME 请求命中后应由本机返回 204；广告控制响应的 `data.isAdShow` 应从 `true` 变成 `false`。如果没有相应请求，或广告仍然出现，需要重新捕获出现广告的那次启动，不能通过继续堆叠全域拦截规则证明有效。

反馈时提供 App/Loon 版本、广告出现位置和脱敏后的命中情况。不要在公开 Issue 中粘贴完整请求头、带查询参数的原始 URL、Cookie、Token 或上传原始抓包。

## 开发验证

本仓库不需要安装 Node.js 依赖包。Node.js 20+ 可运行匹配范围测试：

```sh
npm test
```

完整执行 JSON 转换测试还需要 `jq` 位于 PATH 中，或者通过环境变量 `JQ_BIN` 指定可执行文件位置。缺少 jq 时，测试会明确显示跳过，而不是宣称 JSON 转换已经验证。

测试读取实际插件中的正则和 JQ 表达式，验证精确匹配、其他 App 的排除、错误响应和不相关字段保留。测试辅助代码只支持本插件的两种规则形状，**不是 Loon 原生语法解析器**。

[脱敏分析与离线验证记录](docs/analysis.md)

参考：[Loon 新版 Rewrite 文档](https://nsloon.app/docs/Rewrite/rewrite_v2/)、[插件文档](https://nsloon.app/docs/Plugin/)、[MitM 文档](https://nsloon.app/docs/MitM/)。
