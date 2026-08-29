# secrets —— 部署密钥目录

验证期后端把供应商密钥、TTS 密钥等放在这里，作为之后上云的准备。
**真实密钥不进 Git。**

## 怎么用

```bash
cd software/backend/secrets
cp .env.example .env
# 只在本机或部署主机填写 NASCENT_* ，不要提交 .env
```

`app/config.py` 的读取顺序：

1. 进程环境变量 `NASCENT_*`（最高）
2. `software/backend/secrets/.env`（部署约定位置）
3. `software/backend/.env`（本机旧路径，仍然可用）

仓库只跟踪本 README 和 `.env.example`。目录里其它文件（`.env`、证书、`*.pem`）都被 gitignore。

不要把密钥写进 `protocol/`、`software/app/`、固件 `local_config.h` 以外的源码，也不要贴进飞书当唯一出处。
