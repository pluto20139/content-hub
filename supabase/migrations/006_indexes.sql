-- 006_indexes: 索引迁移

-- monitors 表索引
CREATE INDEX idx_monitors_is_active ON monitors (is_active);
CREATE INDEX idx_monitors_platform  ON monitors (platform);
CREATE INDEX idx_monitors_status    ON monitors (status);

-- contents 表索引
CREATE INDEX idx_contents_published_at ON contents (published_at DESC);
CREATE INDEX idx_contents_is_display   ON contents (is_display);
CREATE INDEX idx_contents_monitor_id   ON contents (monitor_id);
CREATE INDEX idx_contents_platform_display
  ON contents (platform, is_display, published_at DESC);
