# 日子有你

一个只供两个人使用的共享待办、完成回忆和纪念日页面。主页完整展示待办，并精选显示纪念日与完成回忆；点击后可进入独立的卡片详情页查看完整记录和距今天数。前端部署在 GitHub Pages，数据由 Supabase 保存；未配置 Supabase 时仍使用当前浏览器的 `localStorage`。

页面入口：

- [`index.html`](index.html)：主页，完整待办 + 纪念日/回忆精选预览。
- [`anniversaries.html`](anniversaries.html)：纪念日卡片详情，支持新建、编辑、删除和未来日期倒数。
- [`memories.html`](memories.html)：完成回忆卡片详情，显示完成时间、距今天数和感悟，可撤回或删除。

详情页的布局参考了开源项目常见的时间线/倒数卡片模式，例如 [amrohan/timeline](https://github.com/amrohan/timeline) 的事件卡片和 [funnyzak/love-page](https://github.com/funnyzak/love-page) 的纪念日倒数表达；项目代码和样式为本项目重新实现。

## 接入 Supabase

1. 在 [Supabase](https://supabase.com/dashboard) 创建项目。
2. 打开 `SQL Editor`，运行 [`supabase/schema.sql`](supabase/schema.sql)。
3. 在 `Authentication > Users > Add user` 手动创建一个用户。邮箱只作为 Supabase 的账号标识，不会出现在正常页面中；不要使用私人邮箱，因为 `config.js` 是公开文件。可填写一个专用标识邮箱，并设置你们共享的强密码。创建时勾选自动确认邮箱，之后两个人都只输入这个共享密码。
4. 修改 `supabase/schema.sql` 末尾的 `login_email` 和昵称，然后运行对应的 `update` 语句。`login_email` 必须和上一步的账号邮箱一致。纪念日直接在网页的“纪念日 > 新建”里添加。
5. 在 `Project Settings > API Keys` 复制 Project URL 和 Publishable key。旧项目也可以使用 anon key。
6. 填入 [`config.js`](config.js)：

```js
window.TWO_PERSON_APP_CONFIG = {
  supabaseUrl: "https://你的项目编号.supabase.co",
  supabasePublishableKey: "sb_publishable_...",
  sharedLoginEmail: "你创建的隐藏账号邮箱"
};
```

Publishable/anon key 可以出现在网页源代码中。不要把 `secret` 或 `service_role` key 放进仓库。

页面只显示一个共享密码输入框。两个人使用同一个隐藏账号和密码登录，不需要邮箱链接，也没有公开注册入口。数据库 RLS 只允许这个隐藏账号访问数据。Supabase 的标识邮箱仍需同时填写到 `config.js` 和 `app_settings.login_email`，它不是秘密，但不会出现在登录界面。

如果登录后显示“这个账号没有访问权限”，在 Supabase `SQL Editor` 执行下面的修复语句，然后退出网页重新登录：

```sql
grant select (id, person_one, person_two)
on public.app_settings to authenticated;

update public.app_settings
set login_email = 'haoni9276@gmail.com', person_one = 'zyx', person_two = 'nzh'
where id = true;
```

## 本地数据迁移

每台设备第一次成功登录云端后，会把该浏览器现有的待办、完成回忆和纪念日合并上传一次。迁移成功会在本地记录 `todoReflectionCloudMigrationV2`，避免重复导入。纪念日从“纪念日”模块的新建按钮添加，会同步到两台设备。

## 自定义域名

在 GitHub 仓库打开 `Settings > Pages > Custom domain`，填入域名。推荐使用 `www.example.com`：

```text
类型    名称    值
CNAME   www     zyx01040608.github.io
```

同时需要根域名时，按照 GitHub Pages 页面给出的 A 记录配置，然后启用 `Enforce HTTPS`。域名切换后记得同步更新 Supabase 的 Site URL 和 Redirect URLs。
