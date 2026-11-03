const fs = require('fs');
const path = require('path');

class NotesService {
  constructor(filePath) {
    const rootDir = path.resolve(__dirname, '..', '..');
    this.filePath = filePath || path.join(rootDir, 'notes.json');
    this.notes = {};
    this.load();
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        this.notes = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      } catch (_) {
        this.notes = {};
      }
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.notes, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save notes:', e);
    }
  }

  getNotes(channelId) {
    return this.notes[channelId] || '';
  }

  setNotes(channelId, text) {
    this.notes[channelId] = text.trim();
    this.save();
    return this.notes[channelId];
  }

  appendNote(channelId, text) {
    const current = this.notes[channelId] || '';
    const updated = current ? `${current}\n• ${text.trim()}` : `• ${text.trim()}`;
    this.notes[channelId] = updated;
    this.save();
    return this.notes[channelId];
  }

  clearNotes(channelId) {
    delete this.notes[channelId];
    this.save();
  }
}

module.exports = { NotesService };
