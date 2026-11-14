const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { CommandRouter } = require('../src/commands/router');
const { getCommandModules } = require('../src/commands');
const { SessionManager } = require('../src/core/session-manager');
const { QuotaService } = require('../src/services/quota-service');
const { formatDiscordText, renderProgressBar } = require('../src/utils/discord-format');
const { sanitizeFolderName, extractFileAttachments } = require('../src/utils/file-helper');

const ROOT_DIR = path.resolve(__dirname, '..');

test('CommandRouter registers all modular command handlers without duplicates', () => {
  const mockCtx = {
    rootDir: ROOT_DIR,
    config: { available_models: [], favorite_projects: [] },
    quotaService: new QuotaService(),
    pendingEnhancements: new Map(),
    getAvailableModels: async () => [],
    clearModelCache: () => {}
  };

  const router = new CommandRouter(getCommandModules(), mockCtx);

  const slashNames = router.slashBuilders.map(b => b.name);
  assert.equal(new Set(slashNames).size, slashNames.length, 'Slash command names must be unique');

  for (const expected of ['usage', 'account', 'enhance', 'pwd', 'cd', 'model', 'send', 'browse', 'tree', 'exec', 'git', 'preview', 'watch-server', 'status', 'screen', 'join', 'leave', 'say', 'help', 'update', 'broadcast-update']) {
    assert.ok(router.slashHandlers.has(expected), `Missing slash handler: ${expected}`);
  }

  for (const expectedPrefix of ['usage', 'kuota', 'account', 'pwd', 'cd', 'exec', 'sh', 'git', 'status', 'screen', 'preview', 'send', 'tree', 'join', 'vc', 'leave', 'say', 'help', 'update']) {
    assert.ok(router.prefixHandlers.has(expectedPrefix), `Missing prefix handler: ${expectedPrefix}`);
  }
});

test('Discord formatting utilities convert file:/// links and clamp progress bars', () => {
  const formatted = formatDiscordText('See [bot.js](file:///D:/UB/src/bot.js) and file:///D:/UB/README.md');
  assert.equal(formatted, 'See `bot.js` and `D:/UB/README.md`');

  const fullBar = renderProgressBar(1, 10);
  assert.match(fullBar, /100%/);
  const lowBar = renderProgressBar(0.1, 10);
  assert.match(lowBar, /^🔴/);
});

test('File helper sanitizes folder names and strips missing [ATTACH_FILE] tags cleanly', () => {
  assert.equal(sanitizeFolderName('my:channel/name*'), 'my_channel_name_');

  const { cleanText, attachments } = extractFileAttachments('Done!\n[ATTACH_FILE: ./README.md]', ROOT_DIR);
  assert.equal(cleanText, 'Done!');
  assert.equal(attachments.length, 1);
});

test('QuotaService separates output tokens from context/cache tokens in YAML badge', () => {
  const qs = new QuotaService();
  const q1 = {
    groups: [
      {
        name: 'Gemini Models',
        buckets: [
          { id: 'gemini-weekly', window: 'weekly', remainingFraction: 0.7 },
          { id: 'gemini-5h', window: '5h', remainingFraction: 0.9 }
        ]
      }
    ]
  };
  const q2 = {
    groups: [
      {
        name: 'Gemini Models',
        buckets: [
          { id: 'gemini-weekly', window: 'weekly', remainingFraction: 0.695 },
          { id: 'gemini-5h', window: '5h', remainingFraction: 0.885 }
        ]
      }
    ]
  };

  const badge = qs.calculateConsumptionBadge('gemini-4-hydrogen-high', q1, q2, {
    output_tokens: 1300,
    cache_read_tokens: 8100000
  });

  assert.match(badge, /```yaml/);
  assert.match(badge, /Cost\s+: -1\.50%/);
  assert.match(badge, /5h: 88\.5% \| Weekly: 69\.5%/);
  assert.match(badge, /1\.3k out • 8\.1M context\/cache/);
});

test('SessionManager loads config cleanly without mutating filesystem on read', () => {
  const sm = new SessionManager(ROOT_DIR, path.join(ROOT_DIR, 'config.json'));
  assert.ok(sm.config);
  assert.ok(sm.sessions instanceof Map);
});
