ALTER TABLE users
  ADD COLUMN IF NOT EXISTS persona_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 从遗留 user_ai_profiles 回填（仅当 persona 仍为空对象时）
UPDATE users u
SET persona_settings = jsonb_strip_nulls(
  jsonb_build_object(
    'schemaVersion', 1,
    'identity', jsonb_strip_nulls(
      jsonb_build_object(
        'assistantName', p.assistant_name,
        'styleTags',
        CASE
          WHEN p.style_preset = 'warm' THEN '友好、温暖'
          WHEN p.style_preset IS NOT NULL AND p.style_preset <> '' THEN p.style_preset
          ELSE NULL
        END
      )
    ),
    'soul',
    CASE
      WHEN p.style_custom IS NOT NULL AND trim(p.style_custom) <> '' THEN
        jsonb_build_object('tone', trim(p.style_custom))
      ELSE NULL
    END,
    'updatedAt', to_jsonb(p.updated_at::text)
  )
)
FROM user_ai_profiles p
WHERE u.id = p.user_id
  AND (u.persona_settings = '{}'::jsonb OR u.persona_settings IS NULL);
