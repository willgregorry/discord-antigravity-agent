const { REST, Routes } = require('discord.js');

/**
 * Central command & component dispatcher implementing the Open/Closed Principle.
 * Feature modules register their own slash builders, prefix aliases, buttons,
 * select menus, and modal handlers without modifying core routing logic.
 */
class CommandRouter {
  constructor(modules, ctx) {
    this.ctx = ctx;
    this.slashBuilders = [];
    this.slashHandlers = new Map();
    this.prefixHandlers = new Map();
    this.buttonMatchers = [];
    this.selectHandlers = new Map();
    this.modalHandlers = new Map();

    for (const modFactory of modules) {
      const mod = typeof modFactory === 'function' ? modFactory(ctx) : modFactory;
      if (mod.slashBuilders) this.slashBuilders.push(...mod.slashBuilders);
      if (mod.slash) {
        for (const [name, fn] of Object.entries(mod.slash)) {
          this.slashHandlers.set(name, fn);
        }
      }
      if (mod.prefix) {
        for (const [name, fn] of Object.entries(mod.prefix)) {
          this.prefixHandlers.set(name, fn);
        }
      }
      if (mod.buttons) {
        for (const entry of mod.buttons) {
          this.buttonMatchers.push(entry);
        }
      }
      if (mod.selects) {
        for (const [id, fn] of Object.entries(mod.selects)) {
          this.selectHandlers.set(id, fn);
        }
      }
      if (mod.modals) {
        for (const [id, fn] of Object.entries(mod.modals)) {
          this.modalHandlers.set(id, fn);
        }
      }
    }
  }

  /**
   * Clears duplicate guild-scoped commands and registers global slash commands
   * as the single source of truth.
   */
  async registerSlashCommands(token, client) {
    const rest = new REST({ version: '10' }).setToken(token);
    try {
      for (const [guildId] of client.guilds.cache) {
        try {
          await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: [] });
        } catch (_) {}
      }

      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: this.slashBuilders.map(c => c.toJSON()) }
      );
      console.log(`Slash commands registered cleanly (${this.slashBuilders.length} commands)!`);
    } catch (err) {
      console.error('Failed to register slash commands:', err);
    }
  }

  async dispatchInteraction(interaction, session) {
    if (interaction.isChatInputCommand()) {
      const handler = this.slashHandlers.get(interaction.commandName);
      if (handler) await handler(interaction, session, this.ctx);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      const handler = this.selectHandlers.get(interaction.customId);
      if (handler) await handler(interaction, session, this.ctx);
      return;
    }

    if (interaction.isButton()) {
      for (const entry of this.buttonMatchers) {
        const matched = typeof entry.match === 'function'
          ? entry.match(interaction.customId)
          : entry.match === interaction.customId;
        if (matched) {
          await entry.handle(interaction, session, this.ctx);
          return;
        }
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const handler = this.modalHandlers.get(interaction.customId);
      if (handler) await handler(interaction, session, this.ctx);
    }
  }

  async dispatchPrefix(message, session) {
    const args = message.content.slice(1).trim().split(/\s+/);
    const cmd = (args.shift() || '').toLowerCase();
    const handler = this.prefixHandlers.get(cmd);
    if (handler) {
      await handler(message, args, session, this.ctx);
    }
  }
}

module.exports = { CommandRouter };
