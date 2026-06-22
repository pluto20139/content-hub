-- 002_contents: 内容卡片表
CREATE TABLE contents (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform     VARCHAR(20)  NOT NULL,
  native_id    VARCHAR(200) NOT NULL,
  content_type VARCHAR(20)  NOT NULL,
  title        VARCHAR(300) NOT NULL,
  cover_url    VARCHAR(500),
  original_url VARCHAR(500) NOT NULL,
  published_at TIMESTAMPTZ  NOT NULL,
  monitor_id   BIGINT,
  is_display   BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT contents_platform_check
    CHECK (platform IN ('bilibili', 'youtube', 'zhihu')),
  CONSTRAINT contents_content_type_check
    CHECK (content_type IN ('video', 'article', 'question', 'answer', 'post')),
  CONSTRAINT contents_unique
    UNIQUE (platform, native_id),
  CONSTRAINT contents_monitor_fk
    FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE SET NULL
);

COMMENT ON TABLE  contents IS '内容卡片表，存储抓取到的博主最新内容';
COMMENT ON COLUMN contents.content_type IS '内容类型，用于 Deep Link Schema 选择';
COMMENT ON COLUMN contents.is_display   IS '是否在 H5 信息流展示，超 30 天自动软删除为 false';
COMMENT ON COLUMN contents.created_at   IS '入库时间，软删除基于此字段判断';
