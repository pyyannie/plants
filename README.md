# 植物施肥记录 NFC 应用

**状态：设计和计划已完成，代码一行没写。2026-09-06 暂停，Annie 说约一个月后再做。**

## 这是什么

家里 15+ 盆植物，用手机碰花盆上的 NFC 贴纸（NTAG215），打开一个网页看到这盆的施肥档案，
一键补记一笔。数据存在 GitHub 仓库里，每记一笔 = 一个 commit。

## 重新开始时看这两份文档

| 文档 | 内容 |
|---|---|
| `docs/superpowers/specs/2026-09-06-plants-nfc-design.md` | 设计：为什么这么做、有哪些系统层面绕不开的限制 |
| `docs/superpowers/plans/2026-09-06-plants-nfc.md` | 实施计划：12 个任务，含可直接抄的完整代码和测试 |

计划里 Task 1–10 的代码在临时目录真跑过，**33 个测试全绿**，可以照抄。

## 下一步

1. 从计划的 Task 1 开始，按 checkbox 逐项做
2. Task 7 是视觉检查点，样式要截图给 Annie 确认后再往下
3. Task 11 需要 Annie 先提供**植物名单文件 + 对应照片**，其余任务不依赖它
4. Task 12 上线前，Annie 要先去 GitHub 勾上 Keep my email address private

## 已经做完的准备

- 仓库已 `git init`，分支 `main`
- 仓库级 `user.email` 已设为 `143496086+pyyannie@users.noreply.github.com`，
  避免工作邮箱进入公开提交记录（全局 git 配置未改动）
- 目标远程仓库 `pyyannie/plants`（public，尚未创建）
