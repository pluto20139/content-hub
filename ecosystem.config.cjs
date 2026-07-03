module.exports = {
  apps: [
    {
      name: "content-hub-cron",
      script: "scripts/cron/dist/scheduler.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      node_args: "--env-file=/opt/content-hub/.env.production",
      output: "logs/cron-out.log",
      error: "logs/cron-error.log",
      time: true,
    },
  ],
};
