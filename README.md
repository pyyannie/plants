# 植物施肥记录 NFC 应用

**状态：2026-10-04 恢复开发。需求已修订（见 spec 第 11 节），正在按计划实现。**

## 这是什么

家里 30+ 盆植物，用手机碰花盆上的 NFC 贴纸（NTAG216），打开一个网页看到这盆上次施的肥和最新备注，
一键打卡（可带备注）。网页代码在 public 仓库 `pyyannie/plants`，数据在 private 仓库 `pyyannie/plants-data`，每记一笔 = 一个 commit。

## 重新开始时看这两份文档

| 文档 | 内容 |
|---|---|
| `docs/superpowers/specs/2026-09-06-plants-nfc-design.md` | 设计：为什么这么做、有哪些系统层面绕不开的限制 |
| `docs/superpowers/plans/2026-09-06-plants-nfc.md` | 实施计划：12 个任务，含可直接抄的完整代码和测试 |

计划里 Task 1–10 的代码在临时目录真跑过，**33 个测试全绿**，可以照抄。

## 下一步

1. 从计划的 Task 1 开始，按 checkbox 逐项做
2. Task 7 是视觉检查点，样式要截图给 Annie 确认后再往下
3. 植物名单和照片不用预先准备，上线后在手机上逐盆取名、拍照
4. Task 12 上线前，Annie 要先去 GitHub 勾上 Keep my email address private

## 已经做完的准备

- 仓库已 `git init`，分支 `main`
- 仓库级 `user.email` 已设为 `143496086+pyyannie@users.noreply.github.com`，
  避免工作邮箱进入公开提交记录（全局 git 配置未改动）
- 目标远程仓库 `pyyannie/plants`（public，代码）+ `pyyannie/plants-data`（private，数据），均尚未创建
