-- 001_monitors: 监控目标表
CREATE TABLE monitors (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform        VARCHAR(20)  NOT NULL,
  native_id       VARCHAR(200) NOT NULL,
  display_name    VARCHAR(100) NOT NULL,
  name_auto       BOOLEAN      NOT NULL DEFAULT true,
  original_url    VARCHAR(500) NOT NULL,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  last_sync_at    TIMESTAMPTZ,
  last_content_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  fail_count      INTEGER      NOT NULL DEFAULT 0,
  status          VARCHAR(20)  NOT NULL DEFAULT 'normal',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT monitors_platform_check
    CHECK (platform IN ('bilibili', 'youtube', 'zhihu')),
  CONSTRAINT monitors_status_check
    CHECK (status IN ('normal', 'cookie_expired', 'rate_limited')),
  CONSTRAINT monitors_fail_count_check
    CHECK (fail_count >= 0),
  CONSTRAINT monitors_unique
    UNIQUE (platform, native_id)
);

COMMENT ON TABLE  monitors IS '监控目标表，记录需要追踪的博主';
COMMENT ON COLUMN monitors.platform     IS '平台标识：bilibili / youtube / zhihu';
COMMENT ON COLUMN monitors.native_id    IS '博主在平台内的唯一标识（B站 mid / YouTube channelId / 知乎 people_id 或 column_id）';
COMMENT ON COLUMN monitors.display_name IS '博主显示名称，添加时同步获取一次，管理员可手动编辑';
COMMENT ON COLUMN monitors.name_auto    IS '昵称是否为系统自动生成，true 时 Cron 会尝试刷新，管理员手动编辑后设为 false';
COMMENT ON COLUMN monitors.original_url IS '管理员原始粘贴的链接';
COMMENT ON COLUMN monitors.is_active    IS '是否开启监控，false 时 Cron 跳过';
COMMENT ON COLUMN monitors.last_sync_at IS '最后一次成功同步时间（API 请求成功，不代表有新内容）';
COMMENT ON COLUMN monitors.last_content_at IS '最后一次获得新内容的时间，初始值=创建时间';
COMMENT ON COLUMN monitors.fail_count   IS '连续失败次数，请求成功即归零';
COMMENT ON COLUMN monitors.status       IS '运行状态：normal / cookie_expired / rate_limited（注：cookie_expired 命名继承自 PRD，对 YouTube/知乎等非 Cookie 平台，语义为"抓取异常"）';
