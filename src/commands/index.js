const createAiCommands = require('./ai.commands');
const createWorkspaceCommands = require('./workspace.commands');
const createFilesCommands = require('./files.commands');
const createDevopsCommands = require('./devops.commands');
const createSystemCommands = require('./system.commands');
const createVoiceCommands = require('./voice.commands');
const createMetaCommands = require('./meta.commands');
const createInteractiveCommands = require('./interactive.commands');

/**
 * Central registry of command modules.
 * Open/Closed extension point: append a new feature module here to expose
 * additional slash commands, prefix aliases, buttons, select menus, or modals.
 */
function getCommandModules() {
  return [
    createAiCommands,
    createWorkspaceCommands,
    createFilesCommands,
    createDevopsCommands,
    createSystemCommands,
    createVoiceCommands,
    createMetaCommands,
    createInteractiveCommands
  ];
}

module.exports = { getCommandModules };
