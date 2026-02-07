module.exports = {
  apps: [{
    name: 'mission-control',
    script: 'npm',
    args: 'run start',
    cwd: '/Users/bigwoo/repos/mission-control',
    env: {
      NODE_ENV: 'production',
      OPENCLAW_GATEWAY_URL: 'ws://127.0.0.1:18789',
      OPENCLAW_GATEWAY_TOKEN: 'N4wtBtopenclaw'
    }
  }]
};
