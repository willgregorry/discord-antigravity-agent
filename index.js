require('dotenv').config();
const path = require('path');
const { DiscordAntigravityBot } = require('./bot');

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ Error: DISCORD_TOKEN is missing in .env');
  process.exit(1);
}

const configPath = path.join(__dirname, 'config.json');
const bot = new DiscordAntigravityBot(token, configPath);
bot.start();
