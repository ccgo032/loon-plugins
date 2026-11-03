# 喜马拉雅开屏与自营推广过滤 v2

针对喜马拉雅 iOS 9.5.22。首版在手机上确实改写了广告展示开关，但用户反馈仍有广播剧推广；v2 增加对自营图片/视频弹屏、广告域名及开屏相关配置的处理。

**状态：用户复测 v2 后仍有广播剧开屏广告，当前版本未解决这条开屏。暂不建议继续安装，或将其当作已验证有效的方案。离线测试只验证改写范围，不证明手机上的去广告效果。**

进一步复查发现，已过滤的 firework 投放位置是首页、频道等位置，没有直接证明它们对应当前开屏；此前对该接口的定位不足。正在等待完全断网测试结果，以区分本地已有素材与联网时漏掉的请求。未发布新的猜测版本。

## 更新或安装

插件地址不变：

https://raw.githubusercontent.com/ccgo032/loon-plugins/main/loon/ximalaya-splash.plugin

[插件源码](loon/ximalaya-splash.plugin) · [原始插件](https://raw.githubusercontent.com/ccgo032/loon-plugins/main/loon/ximalaya-splash.plugin)

1. 在 Loon 更新这份插件；名称应显示 **喜马拉雅开屏广告过滤 v2**。若仍显示首版名称，移除首版插件条目，再通过上面的 URL 添加。
2. 保持 Loon 连接并使用规则模式；启用插件、复写、MitM 和 MitM over HTTP/2。证书沿用自己生成且已经信任的证书，无需重装。
3. 先停用其他喜马拉雅专用插件；通用分流和基础广告拦截可保留。本插件无需开启脚本，也无需跳过服务器证书验证。
4. 使用喜马拉雅自带的清理缓存功能时，保留所需的离线音频和本地资料。完全退出后重新打开一次以接收修改后的配置，再退出重开检查。部分广告缓存可能不在普通缓存清理范围内；不要为了测试直接卸载。

## 实际处理范围

| 范围 | v2 的动作 |
|---|---|
| 广告展示接口 | 成功响应中已有的布尔值 data.isAdShow 改成 false |
| 旧客户端开关 | 仅把已有的 enableHttpdns 布尔值 true 改成 false，以减少 App 自行解析域名；不更改系统 DNS |
| 开屏实验配置 | 仅将名为 useNewSplashV3 的计划中 ad&useNewSplashV3 字符串 true 改成字符串 false，其他实验保持原样 |
| 自营弹屏计划 | 在 firework-portal/v12/sync 中删除 type 为 20 的广告位，以及包含图片/视频资源（contentType 为 1 或 4）的推广计划，同时清理投放位置中对应的计划引用；保留本次观察到的 contentType 19 信息填写表单 |
| 广告域名 | 精确拒绝 adse.ximalaya.com、adse.wsa.ximalaya.com、adse.test.ximalaya.com、adsebs.ximalaya.com |
| TME 广告获取 | 保留首版对 getAd/getPbCompressAd 的 POST + ting/ User-Agent 限定，返回 204 |

**开屏实验开关的客户端效果是根据字段名称作出的推断，并不是已证实的“关闭全部广告”接口。** 图片/视频弹屏过滤也会移除部分频道活动和会员装扮推广。接口结构或内容类型改变后，覆盖范围可能变化。

## 验证与隐私

第二份抓包共 175 条请求，其中可直接看到首版把 isAdShow 改成了 false；10 条 TME 广告获取请求没有导出的上游响应头。它们支持首版在执行，不能证明当前推广的唯一来源。

v2 在该抓包上匹配 10 条请求拦截和 5 条响应处理；两条弹屏响应分别删除 1 个和 15 个广告/视觉推广计划，并清理对应的位置引用。检查过的 5 条登录和 7 条支付相关请求没有命中。160 条请求不匹配这些复写。上述数字都是离线回放结果。

四类 JSON 响应会附带本机诊断头 **X-Loon-Ximalaya-Filter: v2**，用于确认下载版本及复写命中；它不会被发送给上游服务器，出现此头也不代表每个 JSON 字段都被修改。

插件仅含原生规则和复写，无 JavaScript、外部 Mock、上报服务器、证书或私钥。原始抓包、账号、Cookie、Token、设备标识均未上传仓库。仓库测试夹具为手写合成数据。

MitM 仅声明 mobwsa.ximalaya.com、mobile.ximalaya.com、tmeadkg.y.qq.com。共享 TME 域名上其他 App 的请求仍可能进入解密；User-Agent 限定不等于按 App 隔离。没有全域通配符、公共 DNS IP 拦截或会员权限改写。若联网、登录或播放异常，停用插件并重开 App；已写入缓存的配置可能不会立刻恢复。

## 开发

Node.js 20+ 和 jq 可执行文件可运行 npm test；也可通过 JQ_BIN 指定 jq 路径。缺少 jq 时转换测试会显示跳过。测试读取实际插件中的正则与 JQ，覆盖错误类型、普通实验保留、表单保留、推广引用清理与不相关字段保留。测试辅助代码不是 Loon 原生解析器。

[脱敏分析记录](docs/analysis.md) · [Loon 复写文档](https://nsloon.app/docs/Rewrite/rewrite_v2/) · [插件文档](https://nsloon.app/docs/Plugin/)
