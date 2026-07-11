-- 016_add_video_summary: 新增视频 AI 总结字段与状态管理

-- 1. 在 contents 表中增加 summary 和 summary_status 字段
ALTER TABLE contents ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE contents ADD COLUMN IF NOT EXISTS summary_status VARCHAR(20) DEFAULT 'none';

-- 2. 为 summary_status 增加约束限制，防止非法状态写入
ALTER TABLE contents DROP CONSTRAINT IF EXISTS contents_summary_status_check;
ALTER TABLE contents ADD CONSTRAINT contents_summary_status_check
  CHECK (summary_status IN ('none', 'pending', 'processing', 'success', 'failed'));

-- 3. 授权匿名用户 (anon) 可以更新 summary_status 字段（以便在前台点击“重试”）
GRANT UPDATE (is_display, summary_status) ON public.contents TO anon;

-- 4. 允许匿名用户将 summary_status 从 'failed' 更新为 'pending' 的 RLS 策略
DROP POLICY IF EXISTS contents_anon_retry_summary ON contents;
CREATE POLICY contents_anon_retry_summary ON contents
  FOR UPDATE TO anon
  USING (summary_status = 'failed')
  WITH CHECK (summary_status = 'pending');

-- 5. 创建触发器：当内容入库时，如果是视频，自动置为 'pending'
CREATE OR REPLACE FUNCTION set_video_summary_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.content_type = 'video' THEN
    NEW.summary_status := 'pending';
  ELSE
    NEW.summary_status := 'none';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_video_summary_status ON contents;
CREATE TRIGGER trigger_set_video_summary_status
  BEFORE INSERT ON contents
  FOR EACH ROW
  EXECUTE FUNCTION set_video_summary_status();
