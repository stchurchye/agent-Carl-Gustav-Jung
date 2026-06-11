-- Bow wow know:用户像素形象配置(狗+小人),结构由 @xzz/shared sanitizePixelAvatarSettings 约束
ALTER TABLE users ADD COLUMN IF NOT EXISTS pixel_avatar JSONB;
