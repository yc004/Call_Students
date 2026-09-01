-- A WeChat Mini Program identity belongs to exactly one enterprise account.
-- Password login remains available as a recovery path.
CREATE UNIQUE INDEX IF NOT EXISTS users_unique_wechat_openid
ON users(wechat_openid)
WHERE wechat_openid IS NOT NULL AND deleted_at IS NULL;
